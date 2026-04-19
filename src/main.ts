import { createScene } from './scene';
import { attachDebugHook } from './debug';
import { attachE2EHook } from './e2e-hook';
import { attachInputHandlers } from './input';
import { INITIAL_STATE, type PlacementState } from './placement';
import { createEnergyLedger } from './economy';
import { createPointsLedger } from './points';
import { createHud } from './hud';

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

let lastTime = performance.now();

function animate(): void {
  requestAnimationFrame(animate);

  const now = performance.now();
  const deltaSeconds = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  energyLedger.tick(deltaSeconds);
  hud.updateEnergy(energyLedger.get());
  hud.updatePoints(pointsLedger.get());

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
