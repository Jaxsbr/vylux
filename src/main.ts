// Game entry point.
//
// Wires up: scene + renderer + Match + driver + AI for faction 1 +
// player input for faction 0. Player faction = 0 (cyan). AI faction =
// 1 (red-orange).
//
// Player interaction:
//   - Click WORKER / DEFENDER / RAIDER → unit trains and spawns at HQ
//     on the next sim tick (standard RTS macro).
//   - Click your own worker → selection ring appears → click a node
//     to assign that worker to harvest there (standard RTS micro).
//   - Esc / right-click clears selection.
// Match-end overlay shows VICTORY/DEFEAT with a Play Again button
// (page reload).

import { autoAssignIdleWorkers, tickAi } from './sim/ai';
import { Match } from './sim/replay';
import type { InitialMatchSpec } from './sim/state';
import type { Faction } from './sim/types';
import { createScene } from './render/scene';
import { SimRenderer } from './render/sim-renderer';
import { startSimDriver, TICK_HZ } from './render/sim-driver';
import { BuildablesPanel, MatchEndOverlay } from './render/player-input';
import { InputController } from './render/input-controller';

const PLAYER_FACTION: Faction = 0;
const AI_FACTION: Faction = 1;

const SPEC: InitialMatchSpec = {
  seed: 42,
  hqs: {
    faction0: { x: 3, y: 3 },
    faction1: { x: 16, y: 16 },
  },
  nodes: [
    { x: 6, y: 6, energy: 200 },
    { x: 13, y: 13, energy: 200 },
    { x: 10, y: 10, energy: 200 },
    { x: 6, y: 13, energy: 200 },
    { x: 13, y: 6, energy: 200 },
  ],
  initialEnergy: 200,
  hqMaxHp: 250,
};

function bootstrap(): void {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('main: #canvas not found');

  function resizeCanvas(): void {
    canvas!.style.width = '100vw';
    canvas!.style.height = '100vh';
    canvas!.width = window.innerWidth * Math.min(window.devicePixelRatio, 2);
    canvas!.height = window.innerHeight * Math.min(window.devicePixelRatio, 2);
  }
  resizeCanvas();

  const scene = createScene(canvas);
  const match = new Match(SPEC);
  const renderer = new SimRenderer(match.sim, scene.entitiesGroup, PLAYER_FACTION);

  const input = new InputController({
    canvas,
    camera: scene.camera,
    unitMeshes: renderer.unitMeshMap,
    nodeMeshes: renderer.nodeMeshMap,
    sim: match.sim,
    playerFaction: PLAYER_FACTION,
  });

  const panel = new BuildablesPanel(PLAYER_FACTION, {
    onTrainKindSelected: (kind) => input.trainUnit(kind),
  }, document.body);

  const matchEnd = new MatchEndOverlay(document.body);

  const driver = startSimDriver(match, renderer, scene, (m) => [
    ...input.takeQueued(),
    ...autoAssignIdleWorkers(m.sim.state, PLAYER_FACTION),
    ...tickAi(m.sim.state, AI_FACTION),
  ]);

  // HUD overlay.
  const hud = document.createElement('div');
  hud.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px',
    'font-family:ui-monospace,Menlo,monospace',
    'font-size:11px', 'color:#9ad', 'pointer-events:none',
    'background:rgba(0,0,0,0.4)', 'padding:6px 10px', 'border-radius:4px',
    'border:1px solid #234', 'white-space:pre',
  ].join(';');
  document.body.appendChild(hud);

  function tickHud(): void {
    requestAnimationFrame(tickHud);
    const s = match.sim.state;
    hud.textContent = [
      `vylux · ${TICK_HZ} Hz · you = cyan`,
      `tick ${s.tick}  winner ${s.winner ?? '–'}`,
      `you  hp ${(s.factions[0].hqHp / 65536).toFixed(0)}  pts ${s.factions[0].points}  e ${(s.factions[0].energy / 65536).toFixed(0)}`,
      `ai   hp ${(s.factions[1].hqHp / 65536).toFixed(0)}  pts ${s.factions[1].points}  e ${(s.factions[1].energy / 65536).toFixed(0)}`,
      `units ${s.units.filter((u) => u.alive).length}  dropped ${driver.droppedSteps}`,
    ].join('\n');

    panel.refresh(match.sim);
    renderer.applyInputVisuals(input.getSelectedUnitId());

    if (s.winner !== null) matchEnd.show(PLAYER_FACTION, s.winner);
  }
  requestAnimationFrame(tickHud);

  window.addEventListener('resize', () => {
    resizeCanvas();
    scene.resize(window.innerWidth, window.innerHeight);
  });
}

bootstrap();
