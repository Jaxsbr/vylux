import { createScene } from './scene';
import { attachDebugHook } from './debug';
import { attachInputHandlers } from './input';
import { INITIAL_STATE, type PlacementState } from './placement';

const bundle = createScene();
const canvas = bundle.renderer.domElement;
canvas.style.display = 'block';
canvas.style.cursor = 'default';
document.body.appendChild(canvas);

const hook = attachDebugHook(bundle);

let state: PlacementState = INITIAL_STATE;

attachInputHandlers({
  target: window,
  canvas,
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
  bundle.renderer.render(bundle.scene, bundle.camera);
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
