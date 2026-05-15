// Three.js scene + orthographic isometric camera + lights.
//
// Pure rendering setup — no sim references, no input handling. The
// sim-renderer module attaches/removes meshes; the driver module owns
// the render loop. Keeping this file boring means it's the cheapest
// piece to swap if we ever change to a different camera angle or
// renderer.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { applyGlowEdgeResolution } from './glow-edge';
import { GRID_CONSTANTS, buildGrid, type GridBundle } from '../grid';

// Default ortho-camera halfHeight (vertical world-units visible).
// Sized to comfortably frame the whole grid plus a little margin —
// derived from gridSize so re-tuning the grid in 3.4+ doesn't leave
// the default zoom-out clipping the corners.
//
// Phase 3.4 adds zoom; the camera controller multiplies this base by a
// scale in [ZOOM_MIN, ZOOM_MAX]. The base value itself is what we'd
// show on a fresh load with no zoom applied.
export const DEFAULT_HALF_HEIGHT = (GRID_CONSTANTS.worldExtent / 2) + 6;

// Zoom bounds. Smaller scale = closer in. Picked to keep individual
// unit meshes legible at the closest zoom and keep the whole map
// visible at the farthest.
export const ZOOM_MIN = 0.25;
// Tightened from 2.0 → 1.0 → 0.68 (≈ four wheel notches in from 1.0
// at ZOOM_STEP=1.1) so the playable area always fills the frame at
// the farthest zoom-out.
export const ZOOM_MAX = 0.68;

// Initial zoom on match start. Defaults to ZOOM_MIN — the playtest
// pattern is to crank zoom-in immediately, and starting there avoids
// the "every match begins with a fistful of wheel scrolls" friction.
export const DEFAULT_ZOOM_SCALE = ZOOM_MIN;

// Camera offset from the look-at target — the iso angle. Held constant
// so panning translates the camera-and-target together without rotating
// the view. Direction matches the prototype's pulled-back upper-right
// look, scaled with worldExtent so a bigger grid keeps the same
// apparent angle and doesn't end up flat.
const CAMERA_OFFSET_RATIO = { x: 0.9, y: 1.1, z: 0.9 };

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  // Post-process composer running RenderPass → UnrealBloomPass →
  // OutputPass. The driver calls composer.render() each frame instead
  // of renderer.render() so bright emissive edges + accent caps pick
  // up a fluorescent halo.
  composer: EffectComposer;
  gridGroup: THREE.Group;
  grid: GridBundle;
  // Add/remove entity meshes via this group so they sit above the grid.
  entitiesGroup: THREE.Group;
  // The iso-camera offset from its look-at target. Pan moves the
  // target; the camera stays at target + this vector. Read-only —
  // returned for the camera controller to compose its own state.
  cameraOffset: THREE.Vector3;
  // Resize handler — call from window 'resize' listener.
  resize(width: number, height: number): void;
  // Apply a new ortho-camera halfHeight (controls zoom). Width is
  // recomputed from the current canvas aspect ratio.
  setHalfHeight(halfHeight: number): void;
  // Shift the sky-gradient UVs based on the current camera target so
  // the background parallaxes subtly with pan. Called per-frame by the
  // sim-driver before composer.render().
  updateBackgroundParallax(): void;
  dispose(): void;
}

// Screen-space sky gradient — dark navy-teal zenith → bright cyan
// horizon band → dark teal ground. Painted onto a CanvasTexture that
// the scene uses as its background. Made taller than the viewport so
// UV offsets can scroll the gradient up/down for parallax as the
// camera pans across the world.
function buildSkyGradient(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 1024;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, c.height);
  g.addColorStop(0.00, '#06121a');
  g.addColorStop(0.45, '#0a1d28');
  g.addColorStop(0.58, '#13344a');
  g.addColorStop(0.66, '#091820');
  g.addColorStop(1.00, '#050d12');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Texture is taller than the visible window so offset.y can scroll
  // it up/down without revealing edges. `repeat.y < 1` shows only the
  // middle slab; offset.y centers it.
  tex.repeat.set(1, 0.6);
  tex.offset.set(0, 0.2);
  tex.needsUpdate = true;
  return tex;
}

// Strength of background parallax. Camera target is clamped to roughly
// ±worldExtent * PAN_LIMIT_RATIO; multiplying by this factor maps that
// pan range to a small UV shift on the sky texture. Tuned subtle — the
// background should drift, not race.
const PARALLAX_FACTOR = -0.0015;

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const scene = new THREE.Scene();
  const skyTex = buildSkyGradient();
  scene.background = skyTex;
  const skyBaseOffsetY = skyTex.offset.y;

  // Orthographic isometric: pulled-back y-axis, gentle pitch.
  const aspect = canvas.clientWidth / canvas.clientHeight;
  let currentHalfHeight = DEFAULT_HALF_HEIGHT * DEFAULT_ZOOM_SCALE;
  const halfWidth = currentHalfHeight * aspect;
  const camera = new THREE.OrthographicCamera(
    -halfWidth, halfWidth,
    currentHalfHeight, -currentHalfHeight,
    -100, 100,
  );
  const cameraOffset = new THREE.Vector3(
    GRID_CONSTANTS.worldExtent * CAMERA_OFFSET_RATIO.x,
    GRID_CONSTANTS.worldExtent * CAMERA_OFFSET_RATIO.y,
    GRID_CONSTANTS.worldExtent * CAMERA_OFFSET_RATIO.z,
  );
  camera.position.copy(cameraOffset);
  camera.lookAt(0, 0, 0);

  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 0.7);
  dir.position.set(10, 20, 10);
  scene.add(dir);

  const grid = buildGrid();
  const gridGroup = grid.group;
  scene.add(gridGroup);

  const entitiesGroup = new THREE.Group();
  entitiesGroup.name = 'entities';
  scene.add(entitiesGroup);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  // ACES tone mapping + linear output give bloom a cinematic falloff
  // without crushing the existing dark UI palette. OutputPass below
  // applies tone mapping + sRGB conversion after the bloom pass.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Bloom pass tuned for fluorescent neon trim lines + accent caps
  // without washing the dark grid. Threshold > 0 keeps the background
  // and dim body fills out of the bloom buffer; strength + radius
  // give the trim a soft halo that reads as a glowing tube edge.
  const composer = new EffectComposer(renderer);
  composer.setSize(canvas.clientWidth, canvas.clientHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(canvas.clientWidth, canvas.clientHeight),
    0.55, // strength
    0.4,  // radius
    0.5,  // threshold — only the brightest accents bloom; trim lines glow gently
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // Snap glow-edge materials to the actual canvas size now that the
  // renderer is sized. The resize handler keeps them in sync after.
  applyGlowEdgeResolution(canvas.clientWidth, canvas.clientHeight);

  return {
    scene,
    camera,
    renderer,
    composer,
    gridGroup,
    grid,
    entitiesGroup,
    cameraOffset,
    resize(width, height) {
      const a = width / height;
      const hw = currentHalfHeight * a;
      camera.left = -hw;
      camera.right = hw;
      camera.top = currentHalfHeight;
      camera.bottom = -currentHalfHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      bloomPass.resolution.set(width, height);
      applyGlowEdgeResolution(width, height);
    },
    updateBackgroundParallax() {
      // Camera position = target + cameraOffset, so camera.position
      // minus the static offset gives the current pan target. Iso pan
      // moves along both x and z; their sum is what reads as "deeper
      // into / out of the scene" on screen, which is the axis the
      // vertical gradient should drift along.
      const targetX = camera.position.x - cameraOffset.x;
      const targetZ = camera.position.z - cameraOffset.z;
      skyTex.offset.y = skyBaseOffsetY + (targetX + targetZ) * PARALLAX_FACTOR;
    },
    setHalfHeight(halfHeight) {
      currentHalfHeight = halfHeight;
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      const a = w === 0 || h === 0 ? 1 : w / h;
      const hw = currentHalfHeight * a;
      camera.left = -hw;
      camera.right = hw;
      camera.top = currentHalfHeight;
      camera.bottom = -currentHalfHeight;
      camera.updateProjectionMatrix();
    },
    dispose() {
      renderer.dispose();
    },
  };
}

// Convert a tile-space coordinate (sim's native units, possibly fractional)
// to a Three.js world-space coordinate. The grid is centred at world origin
// with each tile = `tileSize` world units. Offset is derived from
// GRID_CONSTANTS so changing the grid size doesn't strand a hardcoded
// literal here.
export function tileFloatToWorld(
  tileX: number,
  tileY: number,
): { x: number; z: number } {
  const { tileSize, worldExtent } = GRID_CONSTANTS;
  const offset = -worldExtent / 2 + tileSize / 2;
  return { x: offset + tileX * tileSize, z: offset + tileY * tileSize };
}
