import { createScene } from './scene';
import { attachDebugHook } from './debug';

const bundle = createScene();
const canvas = bundle.renderer.domElement;
canvas.style.display = 'block';
document.body.appendChild(canvas);

const hook = attachDebugHook(bundle);

function animate(): void {
  requestAnimationFrame(animate);
  bundle.renderer.render(bundle.scene, bundle.camera);
}
animate();

window.addEventListener('resize', () => {
  bundle.resize(window.innerWidth, window.innerHeight);
});

canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  console.error('[vylux] webglcontextlost', { timestamp: Date.now() });
  if (hook) {
    hook.debug.contextLost = true;
  }
});
