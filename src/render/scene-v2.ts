// Three.js scene + orthographic isometric camera + lights.
//
// Pure rendering setup — no sim references, no input handling. The
// sim-renderer module attaches/removes meshes; the driver module owns
// the render loop. Keeping this file boring means it's the cheapest
// piece to swap if we ever change to a different camera angle or
// renderer.

import * as THREE from 'three';
import { buildGrid, type GridBundle } from '../grid';

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  gridGroup: THREE.Group;
  grid: GridBundle;
  // Add/remove entity meshes via this group so they sit above the grid.
  entitiesGroup: THREE.Group;
  // Resize handler — call from window 'resize' listener.
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createScene(canvas: HTMLCanvasElement): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090c);

  // Orthographic isometric: pulled-back y-axis, gentle pitch.
  const aspect = canvas.clientWidth / canvas.clientHeight;
  const halfHeight = 14;
  const halfWidth = halfHeight * aspect;
  const camera = new THREE.OrthographicCamera(
    -halfWidth, halfWidth,
    halfHeight, -halfHeight,
    -100, 100,
  );
  camera.position.set(18, 22, 18);
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
    resize(width, height) {
      const a = width / height;
      const hh = 14;
      const hw = hh * a;
      camera.left = -hw;
      camera.right = hw;
      camera.top = hh;
      camera.bottom = -hh;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    },
    dispose() {
      renderer.dispose();
    },
  };
}

// Convert a tile-space coordinate (sim's native units, possibly fractional)
// to a Three.js world-space coordinate. The grid is centred at world origin
// with each tile = 1 world unit.
export function tileFloatToWorld(
  tileX: number,
  tileY: number,
): { x: number; z: number } {
  const offset = -10 + 0.5; // -worldExtent/2 + tileSize/2 from grid.ts
  return { x: offset + tileX, z: offset + tileY };
}
