// Three.js scene + orthographic isometric camera + lights.
//
// Pure rendering setup — no sim references, no input handling. The
// sim-renderer module attaches/removes meshes; the driver module owns
// the render loop. Keeping this file boring means it's the cheapest
// piece to swap if we ever change to a different camera angle or
// renderer.

import * as THREE from 'three';
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
export const ZOOM_MAX = 2.0;

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
  dispose(): void;
}

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090c);

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

  return {
    scene,
    camera,
    renderer,
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
