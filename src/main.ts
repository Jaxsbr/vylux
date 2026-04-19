import { createScene } from './scene';
import { attachDebugHook } from './debug';
import { attachE2EHook } from './e2e-hook';
import { attachInputHandlers } from './input';
import { INITIAL_STATE, type PlacementState } from './placement';

const bundle = createScene();
const canvas = bundle.renderer.domElement;
canvas.style.display = 'block';
canvas.style.cursor = 'default';
document.body.appendChild(canvas);

const hook = attachDebugHook(bundle);
attachE2EHook(bundle);

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

function animate(): void {
  requestAnimationFrame(animate);
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
