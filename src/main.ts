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
import { generateEnergyField } from './sim/map-gen';
import { GRID_CONSTANTS } from './grid';
import { createScene, tileFloatToWorld } from './render/scene';
import { toFloat } from './sim/fixed';
import { SimRenderer } from './render/sim-renderer';
import { startSimDriver, TICK_HZ } from './render/sim-driver';
import { DesyncOverlay, MatchEndOverlay } from './render/player-input';
import { ActionBar } from './render/action-bar';
import { SelectionPortrait } from './render/selection-portrait';
import { InputController } from './render/input-controller';
import { CameraController } from './render/camera-controller';
import { Minimap } from './render/minimap';
import { FeedbackOverlay } from './render/feedback';
import { FogOverlay } from './render/fog-overlay';
import { Exploration } from './render/exploration';
import { AudioManager } from './audio/audio-manager';
import { GameEventDetector } from './render/event-detector';
import { MainMenu, type MenuMode } from './render/menu/main-menu';
import { TutorialController } from './render/tutorial/tutorial-controller';
import { FirstActionNudge } from './render/tutorial/first-action-nudge';
import { loadFactionId } from './render/factions/persistence';
import { factionFromId, RESOURCE_COLOR, themeForFaction, type FactionId } from './render/factions/theme';
import { scoreBreakdown } from './sim/score';
import { LockstepChannel, type BroadcastChannelLike } from './net/lockstep-channel';
import { LockstepLoop } from './net/lockstep-loop';
import { ObserverChannel } from './net/observer-channel';
import { ObserverLoop } from './net/observer-loop';
import { WebRtcTransport } from './net/webrtc-transport';
import { isValidRoomCode } from './net/signaling-protocol';

// Phase C.6.5 — bigger arena (64×64) with a randomised energy field.
//
// HQs sit in opposite corners with real travel distance between them
// (anti-diagonal layout: F0/player bottom-left, F1/AI top-right as the camera
// reads it — world +X is screen-right, +Z is screen-down at this iso angle, so
// (8, 55) lands bottom-left). The energy nodes are no longer hand-placed: a
// seeded generator scatters ~16 of them with randomised low/med/high values,
// off the HQ/edge tiles, with ≥1 node guaranteed in each HQ's vision. See
// docs/plan.md "Phase C.6.5" + src/sim/map-gen.ts.
const HQ_F0 = { x: 8, y: 55 }; // player — bottom-left
const HQ_F1 = { x: 55, y: 8 }; // AI — top-right
const NODE_COUNT = 16;
// HQ vision is 8 tiles (units-config HQ_VISION_RADIUS = fromInt(8)); the
// generator uses it to guarantee each HQ starts with a discoverable node.
const HQ_VISION_TILES = 8;
const DEFAULT_MAP_SEED = 42;
// Pre-Phase-D scored match: live PvA / lockstep / observe matches end at the
// buzzer (or early on full field exhaustion) and the higher score wins (see
// sim/score.ts + checkWinner in sim/step.ts). 15 min × 60 s × 20 Hz = 18000
// ticks. Tutorial + tests + the determinism-gate scripted matches leave
// `matchLengthTicks` unset so their behavior is unchanged.
const MATCH_LENGTH_TICKS = 15 * 60 * TICK_HZ;

// Build the energy field for a normal match from a seed. Pure + seeded, so the
// same seed always yields the same layout; the chosen seed is baked into the
// spec and serialised into the replay, so the map reproduces on replay.
function buildEnergyField(seed: number): InitialMatchSpec['nodes'] {
  return generateEnergyField({
    seed,
    gridSize: GRID_CONSTANTS.gridSize,
    hqs: [HQ_F0, HQ_F1],
    count: NODE_COUNT,
    hqVisionRadiusTiles: HQ_VISION_TILES,
  });
}

const SPEC: InitialMatchSpec = {
  seed: DEFAULT_MAP_SEED,
  // Phase C.6.6: hand the A* pathfinder the live grid extent (sim is otherwise
  // grid-size agnostic).
  gridSize: GRID_CONSTANTS.gridSize,
  hqs: { faction0: HQ_F0, faction1: HQ_F1 },
  // Default field from the fixed seed. PvA / observe matches override this
  // with a fresh per-launch seed (see the matchSpec construction below);
  // lockstep keeps this fixed layout so both peers agree (no desync).
  nodes: buildEnergyField(DEFAULT_MAP_SEED),
  initialEnergy: 200,
  hqMaxHp: 250,
  // Opts the live match into the scored / timed end. Tutorial leaves it off
  // so the sandbox stays open-ended.
  matchLengthTicks: MATCH_LENGTH_TICKS,
};

// Phase C.6: the tutorial sandbox. Deterministic seed, generous starting
// energy, and energy nodes HAND-PLACED (not randomised) clustered near BOTH
// corners so the player's home patch is rich whichever faction (corner) they
// picked — the coach ghost-cursor + harvest step depend on a known layout. The
// enemy HQ sits in the far corner exactly as in a normal match, but tutorial
// mode does not run the AI command path, so it stays passive for the "find the
// enemy HQ" goal. Coordinates re-fitted to the 64×64 grid (C.6.5).
const TUTORIAL_SPEC: InitialMatchSpec = {
  seed: 7,
  gridSize: GRID_CONSTANTS.gridSize,
  hqs: {
    faction0: HQ_F0,
    faction1: HQ_F1,
  },
  nodes: [
    // faction-0 corner (bottom-left, near HQ (8,55))
    { x: 12, y: 55, amount: 500 },
    { x: 8, y: 51, amount: 500 },
    { x: 13, y: 52, amount: 500 },
    // faction-1 corner (top-right, near HQ (55,8))
    { x: 51, y: 8, amount: 500 },
    { x: 55, y: 12, amount: 500 },
    { x: 52, y: 13, amount: 500 },
    // Phase D.1: one matter node per corner so matter is VISIBLE/discoverable
    // in the tutorial (point-symmetric about the 64-grid centre, so each
    // corner is equivalent). Not a required step — the player has starting
    // matter for the pod; this is the "go find more" beat.
    { x: 8, y: 48, amount: 300, kind: 'matter' },  // f0 corner
    { x: 55, y: 15, amount: 300, kind: 'matter' }, // f1 corner (mirror)
  ],
  initialEnergy: 400,
  // Phase D.1: enough matter to build the tutorial's work pod (30 M) without
  // first hauling any, so the buildPod step never blocks; the matter node
  // above lets the player harvest more if they explore.
  initialMatter: 60,
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
  const bootParams = new URLSearchParams(window.location.search);
  const skipMenu = bootParams.get('menu') === 'skip';
  // Phase C.6: ?tutorial=1 deep-links straight into the sandbox (e2e + share
  // links), mirroring ?menu=skip. Otherwise the menu's Tutorial entry sets it.
  let runTutorial = bootParams.get('tutorial') === '1';
  let pickedFactionId: FactionId = loadFactionId();
  if (mode.kind === 'pva' && !skipMenu && !runTutorial) {
    const picked = await new Promise<{ id: FactionId; mode: MenuMode }>((resolve) => {
      const menu = new MainMenu({
        audio,
        onCommit: (id, m) => {
          menu.hide();
          resolve({ id, mode: m });
        },
      });
    });
    pickedFactionId = picked.id;
    if (picked.mode === 'tutorial') runTutorial = true;
  }
  const isTutorial = runTutorial && mode.kind === 'pva';

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
  // Phase C.6.5: a fresh random energy field per standalone PvA match. The
  // chosen seed is baked into the spec and serialised into the replay, so the
  // layout reproduces. Only a real `pva` (non-tutorial) match randomises:
  //  - the tutorial keeps its hand-placed nodes;
  //  - lockstep peers must agree on the map, so they keep SPEC's fixed seed;
  //  - an `observe-local` tab replays the lockstep players' frames against its
  //    own Sim (see ObserverLoop) and has NO hash-exchange to catch a desync,
  //    so it MUST build the same fixed-seed field the players use — randomising
  //    it would silently diverge the observed match from tick 0.
  const randomiseMap = mode.kind === 'pva' && !isTutorial;
  const baseSpec = isTutorial ? TUTORIAL_SPEC : SPEC;
  const mapSeed = randomiseMap ? (Math.floor(Math.random() * 0x1_0000_0000) >>> 0) : (baseSpec.seed as number);
  const matchSpec: InitialMatchSpec = {
    ...baseSpec,
    ...(randomiseMap ? { seed: mapSeed, nodes: buildEnergyField(mapSeed) } : {}),
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
    : new GameEventDetector(match.sim, playerFaction, audio, () => {
        // Phase C.4: research-complete VFX. Ripple every owned worker +
        // operational pod the instant the upgrade lands.
        if (feedback === null) return;
        const st = match.sim.state;
        for (const u of st.units) {
          if (u.faction === playerFaction && u.alive) {
            feedback.spawnResearchPulse(toFloat(u.x), toFloat(u.y));
          }
        }
        for (const s of st.structures) {
          if (s.faction === playerFaction && s.alive && s.kind === 'workPod' && s.buildTicksRemaining === 0) {
            feedback.spawnResearchPulse(toFloat(s.x), toFloat(s.y));
          }
        }
      });

  // Phase C.6: tutorial controller + first-action nudge. Declared here so the
  // input feedback hooks (constructed just below) can notify the controller of
  // move / harvest orders; both are assigned once the camera is positioned.
  let tutorial: TutorialController | null = null;
  let firstNudge: FirstActionNudge | null = null;

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
      // Phase C.3: each committed command fires its synth cue alongside
      // the existing visual feedback. move = downward swish, harvest =
      // upward chirp (opposite gestures), select = soft rising ping.
      onMoveOrder: (x, y, f) => { audio.moveAssign(); feedback.spawnMovePing(x, y, f); tutorial?.notifyMove(); },
      onAssignToNode: (x, y) => { audio.harvestAssign(); feedback.spawnAssignPulse(x, y); tutorial?.notifyAssignHarvest(); },
      onPlacement: (x, y) => feedback.spawnPlacementBurst(x, y),
      onPlacementHover: (x, y, valid) => feedback.showPlacementPreview(x, y, valid),
      onPlacementHoverEnd: () => feedback.hidePlacementPreview(),
      onSelect: () => audio.select(),
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
    // Phase C.6.9: send the selected worker(s) scouting to reveal fog.
    onScoutSelected: () => { audio.click(); input!.scoutSelectedWorkers(); },
  }, document.body);

  // Bottom-left selection HUD — portrait + name for whatever the player
  // currently has selected. Observer mode omits it for the same reason
  // ActionBar is omitted (no friendly faction to anchor the readout to).
  const portrait = isObserver ? null : new SelectionPortrait(playerFaction, document.body);

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
    // Phase C.6: the tutorial sandbox runs no enemy AI — faction 1's HQ
    // sits passively so the "find the enemy HQ" goal is a calm scouting
    // exercise, not a race against an attacker.
    if (isTutorial) return input!.takeQueued();
    // Single-player vs AI. Phase 3.9.2: no autoAssign for the player.
    // The AI's tickAi handles its own auto-assign internally.
    return [
      ...input!.takeQueued(),
      ...tickAi(m.sim.state, (1 - playerFaction) as Faction),
    ];
  };

  const driver = startSimDriver(match, renderer, scene, commandsCallback);
  haltDriver = () => driver.stop();

  // Phase C.3: start the faction-tinted ambient drone on match begin.
  // Fail-soft + lazy — if the AudioContext hasn't unlocked yet (no user
  // gesture, e.g. ?menu=skip e2e), the bed silently waits for one. The
  // PvAI menu's click/faction-switch cues unlock it before we get here.
  audio.startAmbientBed(playerFaction);

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

  // Phase C.2: minimap (bottom-right). Blips mirror mesh visibility, so it
  // respects fog; clicking it recentres the camera. Observer mode omits it
  // (no player faction to anchor vision to — same as the other HUD panels).
  const minimap = isObserver
    ? null
    : new Minimap(playerFaction, document.body, (x, z) => cameraController.centerOn(x, z));

  // Phase C.6: launch the tutorial controller (sandbox) or, for a normal
  // match, the one-shot first-action nudge. Both read sim + input + the
  // now-positioned camera, and run from tickHud each frame.
  if (input !== null) {
    if (isTutorial) {
      tutorial = new TutorialController({
        sim: match.sim,
        input,
        exploration,
        playerFaction,
        camera: scene.camera,
        canvas,
        audio,
        // Freeze the sim + silence audio the moment the tutorial completes, so
        // nothing keeps working behind the TUTORIAL COMPLETE overlay. (A normal
        // match stops itself on `winner`; the tutorial has none.)
        onComplete: () => { driver.stop(); audio.setMuted(true); },
        onExit: () => { window.location.href = window.location.pathname; },
      });
    } else if (mode.kind === 'pva') {
      firstNudge = new FirstActionNudge(match.sim, input, playerFaction, scene.camera, canvas);
    }
  }

  // Phase 3.10.9 — focused resource bar (top-centre).
  //
  // The pre-pivot HUD was a dense monospace text dump (tick / winner /
  // both factions' resources / units / dropped-steps / peer state). The
  // player only needs to read their OWN resources to know "can I afford
  // this build" — and that decision happens dozens of times per match,
  // so the resource bar is the most-read UI element in the game.
  //
  // Layout: HQ HP card on the left, then Energy + Supply pills. The
  // E glyph is gold (matches action-bar cost glyphs); Supply reads as
  // "used/cap" and turns red when the player is blocked at the cap.
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

  // Supply-at-cap pulse: when supply is full the count flashes red↔white so
  // "you're capped — do something about it" reads at a glance (it's the cue
  // the tutorial's build-a-pod step points at, and useful in any match).
  if (document.getElementById('vy-cap-pulse-kf') === null) {
    const kf = document.createElement('style');
    kf.id = 'vy-cap-pulse-kf';
    kf.textContent =
      '@keyframes vyCapPulse{0%,100%{color:#ff5577}50%{color:#ffffff}}' +
      '.vy-cap-pulse{animation:vyCapPulse 1.05s ease-in-out infinite}';
    document.head.appendChild(kf);
  }

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
  // Phase D.1: Matter goes live — the second spendable resource (construction
  // material). Was reserved + greyed since C.2; now bound to faction.matter
  // each frame, same as Energy.
  const matterCard = makeResourceCard('M', '0', RESOURCE_COLOR.matter, false, factionTint);
  matterCard.root.title = 'Matter — construction material';
  resourceBar.appendChild(matterCard.root);
  const supplyCard = makeResourceCard('S', '0/5', RESOURCE_COLOR.supply, false, factionTint);
  resourceBar.appendChild(supplyCard.root);

  // Pre-Phase-D scored-match HUD (top-right) — match countdown + ranked
  // score per faction. The number shown here is computed by the same
  // `scoreBreakdown` helper the buzzer reads (sim/score.ts), so the
  // player's live read of "I'm winning" is exactly what the timed-end
  // winner decision will rule. Hidden in unscored matches (tutorial /
  // tests / determinism-gate scripted matches all leave matchLengthTicks
  // at 0) — the panel is built once with display:none in that case.
  const scoreboard = document.createElement('div');
  scoreboard.style.cssText = [
    'position:fixed', 'top:14px', 'left:14px',
    'display:flex', 'flex-direction:column', 'gap:6px',
    'padding:10px 14px',
    'background:rgba(7,9,12,0.78)',
    `border:${playerTheme.strokeW}px solid ${playerTheme.primary}`,
    `border-radius:${playerTheme.radius}px`,
    `box-shadow:0 0 8px ${playerTheme.glowSoft}, 0 0 18px rgba(0,0,0,0.55)`,
    'font-family:ui-monospace,Menlo,monospace',
    'pointer-events:none', 'z-index:30',
    'min-width:170px',
    match.sim.state.matchLengthTicks > 0 ? '' : 'display:none',
  ].filter(Boolean).join(';');

  const timerEl = document.createElement('div');
  timerEl.style.cssText = [
    'font-size:24px', 'font-weight:700', 'letter-spacing:0.14em',
    `color:${playerTheme.primary}`,
    `text-shadow:0 0 10px ${playerTheme.glow}`,
    'text-align:center', 'font-variant-numeric:tabular-nums',
  ].join(';');
  timerEl.textContent = '00:00';
  scoreboard.appendChild(timerEl);

  const scoreboardDivider = document.createElement('div');
  scoreboardDivider.style.cssText = `height:1px;background:${playerTheme.primary};opacity:0.35;margin:2px 0`;
  scoreboard.appendChild(scoreboardDivider);

  // One row per faction, in (player, opponent) order. Rows never reorder
  // (no per-frame layout jitter); the rank marker on the leader's row
  // encodes who is currently winning.
  type ScoreRow = { row: HTMLDivElement; rankMark: HTMLSpanElement; scoreEl: HTMLSpanElement };
  const makeScoreRow = (label: string, accent: string): ScoreRow => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;color:#cde';
    const stripe = document.createElement('span');
    stripe.style.cssText = `width:6px;height:14px;background:${accent};box-shadow:0 0 8px ${accent}`;
    row.appendChild(stripe);
    const name = document.createElement('span');
    name.textContent = label;
    name.style.cssText = `font-weight:600;letter-spacing:0.12em;color:${accent};min-width:64px`;
    row.appendChild(name);
    const rankMark = document.createElement('span');
    rankMark.textContent = ' ';
    rankMark.style.cssText = 'width:12px;text-align:center;color:#cde;opacity:0.85';
    row.appendChild(rankMark);
    const scoreEl = document.createElement('span');
    scoreEl.textContent = '0';
    scoreEl.style.cssText = 'flex:1;text-align:right;font-variant-numeric:tabular-nums;font-weight:500';
    row.appendChild(scoreEl);
    return { row, rankMark, scoreEl };
  };
  // In observer mode the panel labels host / join (no "you"); otherwise
  // the player row reads YOU in their faction colour.
  const youFactionId: Faction = isObserver ? 0 : playerFaction;
  const oppFactionId: Faction = (1 - youFactionId) as Faction;
  const youRow = makeScoreRow(
    isObserver ? 'HOST' : 'YOU',
    themeForFaction(youFactionId).primary,
  );
  const oppRow = makeScoreRow(
    isObserver ? 'JOIN' : 'AI',
    themeForFaction(oppFactionId).primary,
  );
  scoreboard.appendChild(youRow.row);
  scoreboard.appendChild(oppRow.row);
  document.body.appendChild(scoreboard);

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
    tutorial?.update(dtMs);
    firstNudge?.update(dtMs);
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
    matterCard.value.textContent = `${(me.matter / 65536).toFixed(0)}`;
    supplyCard.value.textContent = `${me.supplyUsed}/${me.supplyCap}`;
    const blocked = me.supplyUsed >= me.supplyCap;
    supplyCard.root.style.borderColor = blocked ? '#ff5577' : '#234';
    if (blocked) {
      // Let the pulse keyframe own the colour while capped.
      supplyCard.value.classList.add('vy-cap-pulse');
      supplyCard.value.style.color = '';
    } else {
      supplyCard.value.classList.remove('vy-cap-pulse');
      supplyCard.value.style.color = '#cde';
    }

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
    const selNode = input?.getSelectedNodeId() ?? null;
    panel?.refresh(match.sim, selection, selStructure, selHq, selNode);
    portrait?.refresh(match.sim, selection, selStructure, selHq, selNode);
    portrait?.animate(dtSeconds);
    minimap?.update(match.sim, renderer, cameraController.getTarget());
    renderer.applyInputVisuals(selection, selStructure, selHq, selNode);
    renderer.setHover(input?.getHoveredEntity() ?? null);

    // Scored-match HUD updater. No-op when the panel is hidden — the
    // textContent assignments don't reflow a display:none element. The
    // countdown reads remaining = matchLengthTicks - s.tick, clamped at
    // 0, and rounds UP to seconds so the timer never shows a misleading
    // 00:00 while the sim still has a tick left (it only hits 00:00 the
    // moment the winner is set).
    if (s.matchLengthTicks > 0) {
      const remaining = Math.max(0, s.matchLengthTicks - s.tick);
      const seconds = Math.ceil(remaining / TICK_HZ);
      const mm = Math.floor(seconds / 60).toString().padStart(2, '0');
      const ss = (seconds % 60).toString().padStart(2, '0');
      timerEl.textContent = `${mm}:${ss}`;
      const sb0 = scoreBreakdown(s, 0);
      const sb1 = scoreBreakdown(s, 1);
      const youScore = youFactionId === 0 ? sb0.total : sb1.total;
      const oppScore = oppFactionId === 0 ? sb0.total : sb1.total;
      youRow.scoreEl.textContent = String(youScore);
      oppRow.scoreEl.textContent = String(oppScore);
      if (youScore > oppScore) {
        youRow.rankMark.textContent = '▲';
        oppRow.rankMark.textContent = ' ';
      } else if (oppScore > youScore) {
        youRow.rankMark.textContent = ' ';
        oppRow.rankMark.textContent = '▲';
      } else {
        youRow.rankMark.textContent = '=';
        oppRow.rankMark.textContent = '=';
      }
    }

    if (s.winner !== null) matchEnd.show(playerFaction, s.winner, s);
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
      // Phase C.6: tutorial introspection for the e2e spec.
      tutorial: {
        phase: () => tutorial?.getPhase() ?? null,
        step: () => tutorial?.getStepId() ?? null,
        goals: () => tutorial?.getGoalState() ?? null,
      },
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
