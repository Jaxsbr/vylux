// Entry point for the sim-driven game (Phase 1.4+).
//
// Wires up: scene + renderer + Match + driver + AI commands for both
// factions. No mouse input yet — that's Phase 1.5. For now this is a
// fast way to watch the new sim run live, against a real renderer.
//
// The prototype's main.ts is untouched. Reach this entry by visiting
// /index-v2.html on the dev server.

import { tickAi } from './sim/ai';
import { Match } from './sim/replay';
import type { InitialMatchSpec } from './sim/state';
import { createScene } from './render/scene-v2';
import { SimRenderer } from './render/sim-renderer';
import { startSimDriver, TICK_HZ } from './render/sim-driver';

const SPEC: InitialMatchSpec = {
  seed: 99,
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
  if (!canvas) throw new Error('main-v2: #canvas not found');

  // Size canvas to viewport.
  function resizeCanvas(): void {
    canvas!.style.width = '100vw';
    canvas!.style.height = '100vh';
    canvas!.width = window.innerWidth * Math.min(window.devicePixelRatio, 2);
    canvas!.height = window.innerHeight * Math.min(window.devicePixelRatio, 2);
  }
  resizeCanvas();

  const scene = createScene(canvas);

  const match = new Match(SPEC);
  const renderer = new SimRenderer(match.sim, scene.entitiesGroup);
  const driver = startSimDriver(match, renderer, scene, (m) => [
    ...tickAi(m.sim.state, 0),
    ...tickAi(m.sim.state, 1),
  ]);

  // Tiny corner HUD: tick / winner / dropped steps.
  const hud = document.createElement('div');
  hud.style.cssText = [
    'position:fixed', 'top:8px', 'left:8px',
    'font-family:ui-monospace,Menlo,monospace',
    'font-size:11px', 'color:#9ad', 'pointer-events:none',
    'background:rgba(0,0,0,0.4)', 'padding:6px 10px', 'border-radius:4px',
    'border:1px solid #234',
  ].join(';');
  document.body.appendChild(hud);

  function tickHud(): void {
    requestAnimationFrame(tickHud);
    const s = match.sim.state;
    hud.textContent = [
      `vylux sim-v2 · ${TICK_HZ} Hz`,
      `tick ${s.tick}  winner ${s.winner ?? '–'}`,
      `f0  hp ${(s.factions[0].hqHp / 65536).toFixed(0)}  pts ${s.factions[0].points}  e ${(s.factions[0].energy / 65536).toFixed(0)}`,
      `f1  hp ${(s.factions[1].hqHp / 65536).toFixed(0)}  pts ${s.factions[1].points}  e ${(s.factions[1].energy / 65536).toFixed(0)}`,
      `units ${s.units.filter((u) => u.alive).length}  dropped ${driver.droppedSteps}`,
    ].join('\n');
    hud.style.whiteSpace = 'pre';
  }
  requestAnimationFrame(tickHud);

  window.addEventListener('resize', () => {
    resizeCanvas();
    scene.resize(window.innerWidth, window.innerHeight);
  });
}

bootstrap();
