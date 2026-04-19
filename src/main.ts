import { createScene } from './scene';
import { attachDebugHook } from './debug';
import { attachE2EHook } from './e2e-hook';
import { attachInputHandlers } from './input';
import { INITIAL_STATE, type PlacementState } from './placement';
import { createEnergyLedger } from './economy';
import { createPointsLedger } from './points';
import { createHud } from './hud';
import { selectWorker, getSelected } from './selection';

const bundle = createScene();
const canvas = bundle.renderer.domElement;
canvas.style.display = 'block';
canvas.style.cursor = 'default';
document.body.appendChild(canvas);

const hook = attachDebugHook(bundle);

const energyLedger = createEnergyLedger();
const pointsLedger = createPointsLedger();
const hud = createHud();

// Expose HUD setters on the window hook so E2E specs and debug can
// force deterministic values.
const setEnergy = (patch: Parameters<typeof energyLedger.set>[0]): void => {
  energyLedger.set(patch);
  hud.updateEnergy(energyLedger.get());
};
const setPoints = (patch: Parameters<typeof pointsLedger.set>[0]): void => {
  pointsLedger.set(patch);
  hud.updatePoints(pointsLedger.get());
};

if (hook) {
  hook.setEnergy = setEnergy;
  hook.setPoints = setPoints;
  // Read-only worker tile helper — always available in dev mode for Playwright assertions.
  hook.getWorkerTile = (index: number) => {
    const w = bundle.workers[index];
    if (w === undefined) return null;
    return { tileX: w.tileX, tileY: w.tileY };
  };
}

attachE2EHook(bundle, { setEnergy, setPoints });

let state: PlacementState = INITIAL_STATE;

attachInputHandlers({
  target: window,
  canvas,
  raycastPointer: bundle.raycastPointer,
  getState: () => state,
  setState: (next) => {
    state = next;
    if (hook) {
      hook.state = next;
    }
  },
});

// Worker click-to-select / click-to-move wiring.
// Left-click on a blue worker selects it.
// Left-click on grid tile while a blue worker is selected moves that worker.
// Left-click on red worker / HQ / node (anything non-blue-worker on grid) deselects.
canvas.addEventListener('pointerdown', (event: PointerEvent) => {
  if (event.button !== 0) return;
  // Only process in idle mode — placement mode owns its own click logic.
  if (state.mode !== 'idle') return;

  const workerHit = bundle.raycastWorker(event.clientX, event.clientY);
  if (workerHit !== null) {
    if (workerHit.faction === 'blue') {
      selectWorker(workerHit);
    } else {
      // Red worker click — deselect.
      selectWorker(null);
    }
    return;
  }

  const tileHit = bundle.raycastPointer(event.clientX, event.clientY);
  const current = getSelected();
  if (current !== null && tileHit !== null) {
    current.moveTo(tileHit.tileX, tileHit.tileY);
  } else if (tileHit !== null) {
    // Clicked empty tile with no selection — deselect (already null, no-op).
  } else {
    // Off-grid click — deselect.
    selectWorker(null);
  }
});

let lastTime = performance.now();

function animate(): void {
  requestAnimationFrame(animate);

  const now = performance.now();
  const deltaSeconds = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  energyLedger.tick(deltaSeconds);
  hud.updateEnergy(energyLedger.get());
  hud.updatePoints(pointsLedger.get());

  // Tick all workers (movement).
  for (const w of bundle.workers) {
    w.tick(deltaSeconds);
  }

  bundle.reconcile(state);
  bundle.render();
}
animate();

window.addEventListener('resize', () => {
  bundle.resize(window.innerWidth, window.innerHeight);
});

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  console.error('[vylux] webglcontextlost', { timestamp: Date.now() });
  bundle.contextLost.current = true;
});
