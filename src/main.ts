// Game entry point.
//
// Run modes, picked from the URL:
//   - default (no params): single-player vs scripted AI. Player is
//     faction 0 (cyan); AI controls faction 1 (red-orange).
//   - ?lockstep=host  / ?lockstep=join                — Phase 2.0 local
//       two-tab lockstep over BroadcastChannel. Same-machine determinism
//       gate; no network involved. Each tab is one faction; AI off.
//   - ?lockstep=host&room=ABCDEF / ?lockstep=join&room=ABCDEF
//                                                       — Phase 2.1 WebRTC
//       lockstep across the network. The two clients reach each other
//       via the signaling server (WebSocket); once the datachannel is
//       open, gameplay traffic is peer-to-peer and the signaling server
//       is dormant. Same LockstepChannel sits on top — only the
//       transport substrate changes.
//   - ?lockstep=observe                                 — Phase 2.5 local
//       observer prototype. A third tab joins the same BroadcastChannel
//       as host + join, listens for player frames, runs the sim
//       read-only. No input, no buildables panel; HUD shows both
//       factions' state. Proves the technical pattern that broadcast
//       tooling will eventually need; WebRTC observer through the
//       signaling relay is a 2.5 follow-up.
//
// The signaling server URL defaults to ws://<host>:5182 in dev.
// Override at runtime with ?signaling=<ws-url> or at build time with
// VITE_SIGNALING_URL.
//
// Player interaction (Phase 3.3):
//   - Click WORKER / DEFENDER / RAIDER → unit trains and spawns at HQ
//     on the next sim tick (standard RTS macro).
//   - Click your own unit → replaces selection.
//   - Shift+click → toggle a unit in/out of the selection.
//   - Drag a rect on empty ground → all owned units inside are selected
//     (shift+drag adds to existing selection).
//   - With selected workers, click a node → all of them assigned.
//   - Right-click on empty ground → MoveUnit for every selected unit.
//   - Esc / right-click clears selection / cancels placement.
// Match-end overlay shows VICTORY/DEFEAT with a Play Again button
// (page reload).

import { tickAi } from './sim/ai';
import type { Command } from './sim/commands';
import { Match, serialiseReplay } from './sim/replay';
import type { InitialMatchSpec } from './sim/state';
import type { Faction } from './sim/types';
import { createScene, tileFloatToWorld } from './render/scene';
import { toFloat } from './sim/fixed';
import { SimRenderer } from './render/sim-renderer';
import { startSimDriver, TICK_HZ } from './render/sim-driver';
import { DesyncOverlay, MatchEndOverlay } from './render/player-input';
import { ActionBar } from './render/action-bar';
import { InputController } from './render/input-controller';
import { CameraController } from './render/camera-controller';
import { FeedbackOverlay } from './render/feedback';
import { FogOverlay } from './render/fog-overlay';
import { Exploration } from './render/exploration';
import { AudioManager } from './audio/audio-manager';
import { GameEventDetector } from './render/event-detector';
import { MainMenu } from './render/menu/main-menu';
import { loadFactionId } from './render/factions/persistence';
import { factionFromId, RESOURCE_COLOR, themeForFaction, type FactionId } from './render/factions/theme';
import { LockstepChannel, type BroadcastChannelLike } from './net/lockstep-channel';
import { LockstepLoop } from './net/lockstep-loop';
import { ObserverChannel } from './net/observer-channel';
import { ObserverLoop } from './net/observer-loop';
import { WebRtcTransport } from './net/webrtc-transport';
import { isValidRoomCode } from './net/signaling-protocol';

// Phase 3.4 re-tuned for the 32×32 grid. HQs in opposite corners with
// real travel distance between them; Energy nodes near each HQ + a pair
// of mid-distance "second base" nodes; one contested Flux node at the
// dead centre, equidistant between HQs (PRD §6.6's "geographically
// committal third base").
//
// Phase 3.5 adds two faction-locked colour nodes per side (blue near
// F0 HQ, red near F1 HQ). Positioned in the home patch so the owning
// faction can hold them with light defence, but reachable from the
// open midfield so a determined raid can deny them — the lockout-by-
// denial mechanic only matters if the colour nodes are denyable.
const SPEC: InitialMatchSpec = {
  seed: 42,
  hqs: {
    faction0: { x: 4, y: 4 },
    faction1: { x: 27, y: 27 },
  },
  nodes: [
    // Faction 0 home patch (north-west corner).
    { x: 7, y: 4, energy: 200 },
    { x: 4, y: 7, energy: 200 },
    // Faction 1 home patch (south-east corner).
    { x: 24, y: 27, energy: 200 },
    { x: 27, y: 24, energy: 200 },
    // Mid-distance "second base" nodes on the diagonals.
    { x: 11, y: 20, energy: 200 },
    { x: 20, y: 11, energy: 200 },
  ],
  initialEnergy: 200,
  hqMaxHp: 250,
};

const LOCKSTEP_CHANNEL_NAME = 'vylux-lockstep';

// Reused empty set for the observer view (no input controller exists)
// so we don't allocate a fresh Set every rAF.
const EMPTY_SELECTION: ReadonlySet<number> = new Set();

type RunMode =
  | { kind: 'pva'; playerFaction: Faction }
  | { kind: 'lockstep-local'; localFaction: Faction }
  | { kind: 'lockstep-webrtc'; localFaction: Faction; room: string; signalingUrl: string }
  | { kind: 'observe-local' };

function detectRunMode(): RunMode {
  const params = new URLSearchParams(window.location.search);
  const ls = params.get('lockstep');
  if (ls === 'observe') return { kind: 'observe-local' };
  if (ls !== 'host' && ls !== 'join') return { kind: 'pva', playerFaction: 0 };

  const localFaction: Faction = ls === 'host' ? 0 : 1;
  const room = params.get('room');
  if (room !== null) {
    if (!isValidRoomCode(room)) {
      throw new Error(`main: invalid room code "${room}" (6 chars from confusable-free alphabet)`);
    }
    return {
      kind: 'lockstep-webrtc',
      localFaction,
      room,
      signalingUrl: deriveSignalingUrl(params),
    };
  }
  return { kind: 'lockstep-local', localFaction };
}

// TEST-ONLY: when ?desync-test=N is present in the URL, inject a single
// state mutation right after the sim crosses tick N. This is the
// deliberately-corrupted client described in investigation 03 sub-phase
// 2.3 — it lets the desync-detection gate be exercised end-to-end
// without needing a real bug. Production play with no URL param is
// completely unaffected.
function detectDesyncTestTick(params: URLSearchParams): number | null {
  const raw = params.get('desync-test');
  if (raw === null) return null;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function downloadReplay(match: Match, role: string, label: 'replay' | 'desync' = 'replay'): void {
  const json = serialiseReplay(match.toReplay());
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `vylux-${label}-tick${match.tick}-${role}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function deriveSignalingUrl(params: URLSearchParams): string {
  const override = params.get('signaling');
  if (override !== null) return override;
  const buildTime = (import.meta.env.VITE_SIGNALING_URL as string | undefined);
  if (buildTime !== undefined && buildTime.length > 0) return buildTime;
  return `ws://${window.location.hostname || 'localhost'}:5182`;
}

interface ConnectingOverlay {
  set(line: string): void;
  hide(): void;
}

// Phase 3.10.9 — focused resource bar. One pill per gameplay-relevant
// pool. The glyph colour matches the action-bar cost glyphs so a
// player who reads "F 50" on a build button can find the same green F
// in the bar. `large` makes the HQ HP card a touch bigger so it reads
// as the most important pool (which it is — losing it ends the run).
interface ResourceCard {
  root: HTMLDivElement;
  value: HTMLSpanElement;
}

function makeResourceCard(
  letter: string,
  initial: string,
  glyphColor: string,
  large: boolean,
  factionTint: { primary: string; glowSoft: string; strokeW: number; radius: number },
): ResourceCard {
  const root = document.createElement('div');
  root.style.cssText = [
    'display:flex', 'align-items:center', 'gap:10px',
    'padding:' + (large ? '10px 18px' : '8px 14px'),
    'background:rgba(7,9,12,0.78)',
    `border:${factionTint.strokeW}px solid ${factionTint.primary}`,
    `border-radius:${factionTint.radius}px`,
    `box-shadow:0 0 8px ${factionTint.glowSoft}, 0 0 18px rgba(0,0,0,0.55)`,
    'min-width:' + (large ? '94px' : '78px'),
    'transition:border-color 0.15s',
  ].join(';');

  const glyph = document.createElement('span');
  glyph.textContent = letter;
  glyph.style.cssText = [
    'font-size:' + (large ? '18px' : '15px'),
    'font-weight:700', 'letter-spacing:0.18em',
    `color:${glyphColor}`,
    `text-shadow:0 0 10px ${glyphColor}`,
  ].join(';');
  root.appendChild(glyph);

  const value = document.createElement('span');
  value.textContent = initial;
  value.style.cssText = [
    'font-size:' + (large ? '22px' : '20px'),
    'font-weight:500', 'color:#cde',
    'font-variant-numeric:tabular-nums',
    'min-width:' + (large ? '52px' : '40px'),
    'text-align:right',
  ].join(';');
  root.appendChild(value);

  return { root, value };
}

function makeConnectingOverlay(): ConnectingOverlay {
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'inset:0', 'display:flex',
    'align-items:center', 'justify-content:center',
    'background:rgba(7,9,12,0.92)', 'z-index:20',
    'font-family:ui-monospace,Menlo,monospace',
    'color:#9ad', 'font-size:13px', 'letter-spacing:0.12em',
    'white-space:pre', 'text-align:center',
  ].join(';');
  document.body.appendChild(el);
  return {
    set(line) { el.textContent = line; },
    hide() { el.remove(); },
  };
}

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('main: #canvas not found');

  const desyncTestTick = detectDesyncTestTick(new URLSearchParams(window.location.search));

  function resizeCanvas(): void {
    canvas!.style.width = '100vw';
    canvas!.style.height = '100vh';
    canvas!.width = window.innerWidth * Math.min(window.devicePixelRatio, 2);
    canvas!.height = window.innerHeight * Math.min(window.devicePixelRatio, 2);
  }
  resizeCanvas();

  const mode = detectRunMode();

  // Phase 3.9.5 audio manager — constructed early so the main menu can
  // fire its faction-switch + click cues. Resumes the AudioContext on
  // first user gesture (menu interaction qualifies), so the cues land
  // from the very first switch.
  const audio = new AudioManager();

  // Phase 3.11a: PvAI menu picks the player's faction (Swarm/Siege);
  // selection persists in localStorage. Lockstep / observer modes
  // already encode intent in the URL and skip the menu. `?menu=skip`
  // short-circuits the await for e2e tests + any future share-link
  // flow — the persisted pick is honoured in that case.
  const skipMenu = new URLSearchParams(window.location.search).get('menu') === 'skip';
  let pickedFactionId: FactionId = loadFactionId();
  if (mode.kind === 'pva' && !skipMenu) {
    pickedFactionId = await new Promise<FactionId>((resolve) => {
      const menu = new MainMenu({
        audio,
        onCommit: (picked) => {
          menu.hide();
          resolve(picked);
        },
      });
    });
  }

  const playerFaction: Faction = mode.kind === 'pva' || mode.kind === 'observe-local'
    ? factionFromId(pickedFactionId)
    : mode.localFaction;
  const isObserver = mode.kind === 'observe-local';

  // Build the lockstep substrate before the scene so a connection
  // failure fails loudly instead of silently leaving us in a stalled
  // single-player state.
  let substrate: BroadcastChannelLike | null = null;
  let webrtc: WebRtcTransport | null = null;

  if (mode.kind === 'lockstep-local' || mode.kind === 'observe-local') {
    substrate = new BroadcastChannel(LOCKSTEP_CHANNEL_NAME);
  } else if (mode.kind === 'lockstep-webrtc') {
    const overlay = makeConnectingOverlay();
    overlay.set(`connecting · room ${mode.room}\n${mode.signalingUrl}`);
    try {
      webrtc = await WebRtcTransport.connect({
        signalingUrl: mode.signalingUrl,
        room: mode.room,
        role: mode.localFaction === 0 ? 'host' : 'join',
      });
      substrate = webrtc;
    } catch (err) {
      overlay.set(`connection failed\n${(err as Error).message}\nreload to retry`);
      throw err;
    }
    overlay.hide();
  }

  const scene = createScene(canvas);

  // Phase 3.11b: thread the player's pick into the sim spec. The
  // opposing faction-id is what the AI plays — visual asymmetry from
  // 3.11a now backed by sim asymmetry (worker speed + harvest rate as
  // the first cut). Lockstep / observer modes default both slots to
  // swarm/siege so existing dev paths still work; the menu pick only
  // applies to PvAI + observe-local since those are the surfaces that
  // own faction selection.
  const factionId0 = mode.kind === 'pva' || mode.kind === 'observe-local'
    ? (playerFaction === 0 ? pickedFactionId : (pickedFactionId === 'swarm' ? 'siege' : 'swarm'))
    : 'swarm';
  const factionId1: FactionId = factionId0 === 'swarm' ? 'siege' : 'swarm';
  const matchSpec: InitialMatchSpec = {
    ...SPEC,
    factionIds: { faction0: factionId0, faction1: factionId1 },
  };
  const match = new Match(matchSpec);
  // Phase: persistent fog reveal — shared explored-tile bitmap consumed
  // by both SimRenderer (enemy entity visibility) and FogOverlay (alpha
  // baseline). Decouples "have we ever seen this tile?" from "is this
  // tile in current vision?" so enemies stay visible on uncovered map.
  const exploration = new Exploration(match.sim, playerFaction, isObserver);
  const renderer = new SimRenderer(match.sim, scene.entitiesGroup, playerFaction, isObserver, exploration);

  // Phase 3.9.1: input-feedback overlay. Observer mode has nothing to
  // confirm so the overlay is omitted in that path; otherwise the
  // input controller fires hooks into it on every committed command.
  const feedback = isObserver ? null : new FeedbackOverlay(scene.entitiesGroup);

  // Phase 3.9.4: fog of war overlay. Observer mode bypasses (sees the
  // whole map). Player + lockstep modes get the per-faction fog +
  // explored bitmap painted on top of the grid plane.
  const fog = new FogOverlay(scene.entitiesGroup, match.sim, isObserver, exploration);

  // Phase 3.9.5: event detector. Observer mode runs a no-op detector
  // (no player faction to attribute events to). The AudioManager is
  // constructed earlier (above the menu) so the menu's faction-switch
  // cues fire from the first interaction.
  const eventDetector = isObserver
    ? null
    : new GameEventDetector(match.sim, playerFaction, audio);

  // Observer view: no input, no buildables panel. The DOWNLOAD REPLAY
  // path still works (an observer can save its own replay log too —
  // the input frames it received are the same the players sent), so
  // the match-end + R-key flows are unchanged.
  const input = isObserver ? null : new InputController({
    canvas,
    camera: scene.camera,
    unitMeshes: renderer.unitMeshMap,
    nodeMeshes: renderer.nodeMeshMap,
    structureMeshes: renderer.structureMeshMap,
    hqMeshes: renderer.hqMeshMap,
    sim: match.sim,
    playerFaction,
    feedback: feedback === null ? undefined : {
      onMoveOrder: (x, y, f) => feedback.spawnMovePing(x, y, f),
      onAssignToNode: (x, y) => feedback.spawnAssignPulse(x, y),
      onPlacement: (x, y) => feedback.spawnPlacementBurst(x, y),
      // Phase C.1: blocked command on a charge-mode worker → trigger
      // the lightning cue at the worker's position via sim-renderer.
      onEnergyBlocked: (workerId) => renderer.triggerEnergyCue(workerId),
    },
  });

  const panel = isObserver ? null : new ActionBar(playerFaction, {
    // Phase 3.9.5: every panel button fires the UI click cue. The
    // audio manager lazy-creates its AudioContext on first call, so
    // the first click also unlocks the WebAudio gesture requirement.
    onTrainKindSelected: (kind) => { audio.click(); input!.trainUnit(kind); },
    onBuildForgeSelected: () => { audio.click(); input!.enterPlaceForgeMode(); },
    onBuildSpireSelected: () => { audio.click(); input!.enterPlaceSpireMode(); },
    onBuildPylonSelected: () => { audio.click(); input!.enterPlacePylonMode(); },
    onResearchTier2Selected: () => { audio.click(); input!.researchTier2(); },
    onResearchTrailDurationSelected: () => { audio.click(); input!.researchTrailDuration(); },
    onDumpSelected: () => { audio.click(); input!.dumpSelectedWorkers(); },
    // Phase C.1: enter placement mode for a work pod (worker-driven build).
    onBuildWorkPodSelected: () => { audio.click(); input!.enterPlaceWorkPodMode(); },
    // Phase C.1 research: queue the StartResearchAtPod command on the
    // currently-selected pod (action-bar disables the button when not
    // applicable, so this fires only when valid).
    onResearchAutoResumeSelected: () => { audio.click(); input!.researchAutoResume(); },
  }, document.body);

  const role: 'pva' | 'host' | 'join' | 'observe' = (() => {
    switch (mode.kind) {
      case 'pva': return 'pva';
      case 'observe-local': return 'observe';
      default: return playerFaction === 0 ? 'host' : 'join';
    }
  })();
  const triggerDownloadReplay = (): void => downloadReplay(match, role, 'replay');
  const triggerDownloadDesyncReplay = (): void => downloadReplay(match, role, 'desync');
  const matchEnd = new MatchEndOverlay(document.body, triggerDownloadReplay);
  const desyncOverlay = new DesyncOverlay(document.body, triggerDownloadDesyncReplay);

  let lockstep: LockstepChannel | null = null;
  let lockstepLoop: LockstepLoop | null = null;
  let observerChannel: ObserverChannel | null = null;
  let observerLoop: ObserverLoop | null = null;
  let desync: { tick: number; localHash: string; remoteHash: string } | null = null;
  // Forward-ref to the driver's stop method. Set after startSimDriver
  // returns; the desync handler may need to halt the loop before the
  // assignment runs (very-early-tick desyncs are rare but possible),
  // so we tolerate a no-op until then.
  let haltDriver: () => void = () => {};

  if (isObserver && substrate !== null) {
    observerChannel = new ObserverChannel({ channel: substrate });
    observerLoop = new ObserverLoop({ channel: observerChannel });
  } else if (substrate !== null && (mode.kind === 'lockstep-local' || mode.kind === 'lockstep-webrtc')) {
    const localFaction: Faction = mode.localFaction;
    lockstep = new LockstepChannel({
      channel: substrate,
      localFaction,
      onDesync: (r) => {
        if (desync !== null) return; // first divergence wins; ignore later mismatches
        desync = r;
        haltDriver();
        desyncOverlay.show(r);
        // eslint-disable-next-line no-console
        console.error('lockstep desync', r);
      },
    });
    lockstepLoop = new LockstepLoop({
      channel: lockstep,
      // Phase 3.9.2: player-controlled factions no longer auto-assign
      // idle workers. New units stand still until the player gives
      // them an order — agency on creation. The AI's tickAi still
      // calls autoAssignIdleWorkers internally for its own faction.
      // PRD §6.3: "assignment matters and idle workers are a real
      // problem"; the §3.8 idle-worker hotkey is the long-term answer
      // to that problem, not auto-reassignment after deposit.
      collectLocalCommands: () => input!.takeQueued(),
    });
    lockstep.sendHello();
  }

  const commandsCallback = (m: Match): Command[] | null => {
    if (observerLoop !== null) return observerLoop.next(m);
    if (lockstepLoop !== null) return lockstepLoop.next(m);
    // Single-player vs AI. Phase 3.9.2: no autoAssign for the player.
    // The AI's tickAi handles its own auto-assign internally.
    return [
      ...input!.takeQueued(),
      ...tickAi(m.sim.state, (1 - playerFaction) as Faction),
    ];
  };

  const driver = startSimDriver(match, renderer, scene, commandsCallback);
  haltDriver = () => driver.stop();

  // Phase 3.4: camera pan/zoom. Active in every mode (including
  // observer) so the spectator can navigate the larger map. Pan keys +
  // mouse use middle button so they don't conflict with the input
  // controller's left-drag select / right-click move.
  const cameraController = new CameraController({
    canvas,
    camera: scene.camera,
    cameraOffset: scene.cameraOffset,
    setHalfHeight: (hh) => scene.setHalfHeight(hh),
  });

  // Centre the viewport on the player's HQ at match start. Observer mode
  // has no player faction to anchor on, so it keeps the default centred-
  // on-origin view.
  if (!isObserver) {
    const fs = match.sim.state.factions[playerFaction];
    const hqWorld = tileFloatToWorld(toFloat(fs.hqX), toFloat(fs.hqY));
    cameraController.centerOn(hqWorld.x, hqWorld.z);
  }

  // Phase 3.10.9 — focused resource bar (top-centre).
  //
  // The pre-pivot HUD was a dense monospace text dump (tick / winner /
  // both factions' resources / units / dropped-steps / peer state). The
  // player only needs to read their OWN resources to know "can I afford
  // this build" — and that decision happens dozens of times per match,
  // so the resource bar is the most-read UI element in the game.
  //
  // Layout: HQ HP card on the left, then Energy / Flux / Colour /
  // Supply pills, each with the same coloured letter glyph as the
  // action-bar cost glyphs (E gold, F green, C faction-tinted) so a
  // player who reads a build cost can find the matching pool by colour
  // alone. Numbers are big and readable; supply turns red when blocked
  // (used >= cap).
  //
  // Tick / winner / opponent stats / dropped steps / lockstep peer
  // state move to a separate ?debug=1 panel (top-right) — useful for
  // dev sessions, hidden in the default player view.
  const showDebugHud = new URLSearchParams(window.location.search).get('debug') === '1';

  // Resource bar container (top-centre).
  const resourceBar = document.createElement('div');
  resourceBar.style.cssText = [
    'position:fixed', 'top:14px', 'left:50%', 'transform:translateX(-50%)',
    'display:flex', 'gap:10px', 'align-items:stretch',
    'font-family:ui-monospace,Menlo,monospace',
    'pointer-events:none', 'z-index:30',
  ].join(';');
  document.body.appendChild(resourceBar);

  // Phase 3.11a: faction colour comes from the shared theme so menu /
  // HUD / end-screen all read from one palette source.
  const playerTheme = themeForFaction(playerFaction);
  const playerColourHex = playerTheme.primary;
  const factionTint = {
    primary:  playerTheme.primary,
    glowSoft: playerTheme.glowSoft,
    strokeW:  playerTheme.strokeW,
    radius:   playerTheme.radius,
  };

  // HP card — distinct from the resource pills because losing HQ ends
  // the match. Slightly larger; glyph reads in faction colour, border
  // tints to the faction.
  const hpCard = makeResourceCard('HQ', '500', playerColourHex, true, factionTint);
  resourceBar.appendChild(hpCard.root);
  const energyCard = makeResourceCard('E', '0', RESOURCE_COLOR.energy, false, factionTint);
  resourceBar.appendChild(energyCard.root);
  const fluxCard = makeResourceCard('F', '0', RESOURCE_COLOR.flux, false, factionTint);
  resourceBar.appendChild(fluxCard.root);
  const colourCard = makeResourceCard('C', '0', playerColourHex, false, factionTint);
  resourceBar.appendChild(colourCard.root);
  const supplyCard = makeResourceCard('S', '0/10', RESOURCE_COLOR.supply, false, factionTint);
  resourceBar.appendChild(supplyCard.root);

  // Debug panel — opt-in via ?debug=1. Carries the dense diagnostic
  // text the old HUD used to show by default. Same layout (monospace,
  // pre-formatted lines) so existing dev habits survive.
  const debugHud = document.createElement('div');
  debugHud.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px',
    'font-family:ui-monospace,Menlo,monospace',
    'font-size:11px', 'color:#9ad', 'pointer-events:none',
    'background:rgba(0,0,0,0.4)', 'padding:6px 10px', 'border-radius:4px',
    'border:1px solid #234', 'white-space:pre',
    showDebugHud ? '' : 'display:none',
  ].filter(Boolean).join(';');
  document.body.appendChild(debugHud);

  function modeLabel(): string {
    switch (mode.kind) {
      case 'pva': return 'vs ai';
      case 'lockstep-local': return playerFaction === 0 ? 'lockstep host (local)' : 'lockstep join (local)';
      case 'lockstep-webrtc': return playerFaction === 0
        ? `lockstep host · room ${mode.room}`
        : `lockstep join · room ${mode.room}`;
      case 'observe-local': return 'observer (local)';
    }
  }

  let desyncTestFired = false;
  let lastFrameMs = performance.now();

  function tickHud(): void {
    requestAnimationFrame(tickHud);
    const nowMs = performance.now();
    const dtSeconds = Math.min(0.1, (nowMs - lastFrameMs) / 1000);
    const dtMs = dtSeconds * 1000;
    lastFrameMs = nowMs;
    cameraController.update(dtSeconds);
    feedback?.update(dtMs);
    fog.update();
    eventDetector?.update();
    const s = match.sim.state;

    // TEST-ONLY corruption injection. When ?desync-test=N is in the
    // URL, we mutate state once at the first rAF after the sim crosses
    // tick N. The mutated state hashes differently from the peer's, so
    // the desync detection gate must surface within ~1 second (~20
    // ticks at 20 Hz). No-op when the param is absent.
    // Skip in observer mode — the observer doesn't drive the canonical
    // state, and corrupting its local view wouldn't trigger a real
    // desync (no hash exchange).
    if (!isObserver && desyncTestTick !== null && !desyncTestFired && s.tick > desyncTestTick) {
      desyncTestFired = true;
      // Corruption target post-2026-05-07 PvE pivot: nextSpawnRotation
      // is hashed (so the desync surfaces) and only affects the next
      // worker spawn position cosmetically. The previous corruption
      // target — `points` — was removed with the points-threshold win
      // condition.
      s.factions[0].nextSpawnRotation += 1;
      // eslint-disable-next-line no-console
      console.warn(`desync-test: corrupted state at tick ${s.tick} (target was ${desyncTestTick})`);
    }

    // Player-facing resource bar. Observer mode shows the host
    // (faction 0) view by convention — the bar is a single-faction
    // surface; observers who want both should use ?debug=1.
    const viewFaction: 0 | 1 = isObserver ? 0 : playerFaction;
    const me = s.factions[viewFaction];
    hpCard.value.textContent = `${(me.hqHp / 65536).toFixed(0)}`;
    energyCard.value.textContent = `${(me.energy / 65536).toFixed(0)}`;
    // Phase A: flux / colour / supply HUD slots retired with the
    // resources + supply system. The card refs are still rendered as
    // empty placeholders until the HUD layout is rebuilt.
    fluxCard.value.textContent = '–';
    colourCard.value.textContent = '–';
    supplyCard.value.textContent = '–';
    supplyCard.root.style.borderColor = '#234';
    supplyCard.value.style.color = '#cde';

    // Debug panel. Only built if ?debug=1, but cheap to update — the
    // textContent assignment is a no-op when the panel is display:none
    // since the layout doesn't reflow.
    if (showDebugHud) {
      const factionLabelLine = isObserver
        ? `vylux · ${TICK_HZ} Hz · ${modeLabel()} · watching both`
        : `vylux · ${TICK_HZ} Hz · ${modeLabel()} · you = ${playerFaction === 0 ? 'cyan' : 'red'}`;
      const f0Label = isObserver ? 'host' : (playerFaction === 0 ? 'you' : 'opp');
      const f1Label = isObserver ? 'join' : (playerFaction === 0 ? 'opp' : 'you');
      const fmtFaction = (idx: 0 | 1, label: string): string => {
        const fx = s.factions[idx];
        return `${label}  hp ${(fx.hqHp / 65536).toFixed(0)}  e ${(fx.energy / 65536).toFixed(0)}`;
      };
      const lines = [
        factionLabelLine,
        `tick ${s.tick}  winner ${s.winner ?? '–'}`,
        fmtFaction(0, f0Label),
        fmtFaction(1, f1Label),
        `units ${s.units.filter((u) => u.alive).length}  dropped ${driver.droppedSteps}`,
      ];

      if (lockstep !== null && lockstepLoop !== null) {
        const peer = lockstep.peerConnected ? 'connected' : 'waiting';
        const resolved = lockstep.latestResolvedHash();
        const hashLine = resolved === null
          ? 'hash pending'
          : `hash@${resolved.tick} ${resolved.status}`;
        const delayMs = lockstepLoop.inputDelay * (1000 / TICK_HZ);
        lines.push(`peer ${peer}  ${hashLine}  delay ${lockstepLoop.inputDelay}t (${delayMs.toFixed(0)} ms)`);
        if (desync !== null) {
          lines.push(`DESYNC tick ${desync.tick}`);
          lines.push(`  local  ${desync.localHash}`);
          lines.push(`  remote ${desync.remoteHash}`);
        }
      } else if (observerChannel !== null) {
        const presence = observerChannel.bothFactionsSeen ? 'both factions live' : 'waiting for players';
        lines.push(`observer · ${presence}`);
      }

      debugHud.textContent = lines.join('\n');
    }

    const selection = input?.getSelectedUnitIds() ?? EMPTY_SELECTION;
    const selStructure = input?.getSelectedStructureId() ?? null;
    const selHq = input?.getSelectedHqFaction() ?? null;
    panel?.refresh(match.sim, selection, selStructure, selHq);
    renderer.applyInputVisuals(selection, selStructure, selHq);

    if (s.winner !== null) matchEnd.show(playerFaction, s.winner);
  }
  requestAnimationFrame(tickHud);

  window.addEventListener('resize', () => {
    resizeCanvas();
    scene.resize(window.innerWidth, window.innerHeight);
  });

  // Press R during play to save the current input log as a replay.
  // Useful for capturing bug-report material before a match ends; the
  // saved JSON round-trips through tools/replay.ts to the same final
  // hash. Phase 2.4 deliverable.
  //
  // Bail out if any modifier is held — Cmd+R / Ctrl+R is the browser's
  // refresh shortcut, and without this guard every page refresh fires
  // the download immediately before the browser navigates away.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'r' && e.key !== 'R') return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.target instanceof HTMLInputElement) return;
    triggerDownloadReplay();
  });

  // Phase 3.10.3: opt-in test hooks. Only attached when ?test-hooks=1
  // is in the URL — production load / preview test never see them, so
  // preview.spec.ts's "no debug globals" gate stays satisfied. Used by
  // mouse + select e2e specs that need to programmatically focus the
  // HQ / a Forge so the action bar shows the right buttons.
  if (input !== null && new URLSearchParams(window.location.search).get('test-hooks') === '1') {
    (window as unknown as { __vyluxTest?: unknown }).__vyluxTest = {
      selectHq: () => input.selectHqProgrammatic(playerFaction),
      selectStructure: (id: number) => input.selectStructureProgrammatic(id),
      selectAllOwnWorkers: () => input.selectAllOwnWorkersProgrammatic(),
      sim: match.sim,
    };
  }

  // Phase 3.9.5: M toggles mute. Tiny HUD indicator shows the state
  // — purely a status read, the keypress is the binding.
  const muteIndicator = document.createElement('div');
  muteIndicator.style.cssText = [
    'position:fixed', 'top:8px', 'right:8px',
    'font-family:ui-monospace,Menlo,monospace', 'font-size:11px',
    'color:#9ad', 'pointer-events:none',
    'background:rgba(0,0,0,0.4)', 'padding:6px 10px',
    'border-radius:4px', 'border:1px solid #234',
  ].join(';');
  muteIndicator.textContent = 'sound · on  (M to mute)';
  document.body.appendChild(muteIndicator);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'm' && e.key !== 'M') return;
    // Skip on modifier — Cmd+M minimises the window on macOS and we
    // don't want that to flip the mute state on its way out. Mirrors
    // the same guard on the R-replay binding.
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
    if (e.target instanceof HTMLInputElement) return;
    audio.setMuted(!audio.isMuted());
    muteIndicator.textContent = audio.isMuted()
      ? 'sound · off (M to unmute)'
      : 'sound · on  (M to mute)';
  });

  // Tear down the WebRTC transport on tab-close — without this, peers
  // see a half-open RTCPeerConnection until network timeout and the
  // signaling server doesn't get a clean close on its WS.
  window.addEventListener('beforeunload', () => {
    cameraController.detach();
    webrtc?.close();
  });
}

void bootstrap();
