import * as THREE from 'three';
import { tileToWorld } from './grid';
import type { SceneBundle } from './scene';

// E2E-only hook — installed only when the URL contains `?e2e=1`.
// This file is imported by main.ts but the install function exits early unless
// the query param is present, so production builds that never pass ?e2e=1
// never run any of this logic.
//
// State-ownership: this module does NOT write to placement.ts state. It seeds
// placeholder Three.js meshes directly into a dedicated `e2e-overlays` group
// on the scene so the main reconcile loop never sees them.
//
// HQs are NOT seeded here — they are pre-placed by createScene() using the
// real HQ mesh class and are always present in the scene.

const BLUE_HEX = 0x00e5ff;
const RED_HEX = 0xff5a1f;
const NODE_HEX = 0x00ff88;
const BODY_COLOR = '#0d1117';
const PLACED_Y = 0.5;

type SceneName = 'idle-start' | 'early-economy' | 'mid-combat';

function hexColor(hex: number): string {
  return '#' + hex.toString(16).padStart(6, '0');
}

function makeBox(
  size: number,
  height: number,
  colorHex: number,
  y: number,
): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(size, height, size);
  const material = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    emissive: colorHex,
    emissiveIntensity: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: hexColor(colorHex) }),
  );
  edges.name = 'e2e-trim';
  mesh.add(edges);
  mesh.position.y = y;
  return mesh;
}

function makeSphere(radius: number, colorHex: number, y: number): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(radius, 8, 8);
  const material = new THREE.MeshStandardMaterial({
    color: hexColor(colorHex),
    emissive: colorHex,
    emissiveIntensity: 0.8,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = y;
  return mesh;
}

function placeAt(mesh: THREE.Mesh, tileX: number, tileY: number): void {
  const world = tileToWorld(tileX, tileY);
  mesh.position.set(world.x, mesh.position.y, world.z);
}

function clearGroup(group: THREE.Group): void {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((m) => m.dispose());
      } else {
        child.material.dispose();
      }
    }
  }
}

function seedIdleStart(group: THREE.Group): void {
  // HQs are already in the scene from createScene() — do not add duplicates here.
  // Only add energy node placeholders; workers/raiders are later tasks.

  // Four energy nodes scattered across the grid.
  const nodePositions: [number, number][] = [
    [5, 5],
    [14, 5],
    [5, 14],
    [14, 14],
  ];
  for (const [tx, ty] of nodePositions) {
    const node = makeSphere(0.3, NODE_HEX, 0.3);
    node.name = 'e2e-energy-node';
    placeAt(node, tx, ty);
    group.add(node);
  }
}

function seedEarlyEconomy(group: THREE.Group): void {
  seedIdleStart(group);

  // Blue workers near bottom-left node (tile 5,5).
  const blueWorkerPositions: [number, number][] = [
    [5, 5],
    [4, 5],
    [5, 6],
    [6, 5],
  ];
  for (const [tx, ty] of blueWorkerPositions) {
    const worker = makeBox(0.55, 0.55, BLUE_HEX, PLACED_Y);
    worker.name = 'e2e-blue-worker';
    placeAt(worker, tx, ty);
    group.add(worker);
  }

  // Red workers near top-right node (tile 14,14).
  const redWorkerPositions: [number, number][] = [
    [14, 14],
    [13, 14],
    [14, 13],
    [15, 14],
  ];
  for (const [tx, ty] of redWorkerPositions) {
    const worker = makeBox(0.55, 0.55, RED_HEX, PLACED_Y);
    worker.name = 'e2e-red-worker';
    placeAt(worker, tx, ty);
    group.add(worker);
  }
}

function seedMidCombat(group: THREE.Group): void {
  seedIdleStart(group);

  // Blue raiders charging toward the red HQ.
  const blueRaiderPositions: [number, number][] = [
    [15, 16],
    [16, 16],
    [16, 17],
  ];
  for (const [tx, ty] of blueRaiderPositions) {
    const raider = makeBox(0.65, 0.65, BLUE_HEX, PLACED_Y);
    raider.name = 'e2e-blue-raider';
    placeAt(raider, tx, ty);
    group.add(raider);
  }

  // Red defenders near their HQ.
  const redDefenderPositions: [number, number][] = [
    [17, 18],
    [18, 17],
    [17, 17],
  ];
  for (const [tx, ty] of redDefenderPositions) {
    const defender = makeBox(0.75, 0.9, RED_HEX, PLACED_Y);
    defender.name = 'e2e-red-defender';
    placeAt(defender, tx, ty);
    group.add(defender);
  }

  // Some blue workers at their node for economy context.
  const blueWorkerPositions: [number, number][] = [
    [5, 5],
    [4, 5],
  ];
  for (const [tx, ty] of blueWorkerPositions) {
    const worker = makeBox(0.55, 0.55, BLUE_HEX, PLACED_Y);
    worker.name = 'e2e-blue-worker';
    placeAt(worker, tx, ty);
    group.add(worker);
  }
}

function seedScene(name: SceneName, group: THREE.Group): void {
  clearGroup(group);
  if (name === 'idle-start') {
    seedIdleStart(group);
  } else if (name === 'early-economy') {
    seedEarlyEconomy(group);
  } else if (name === 'mid-combat') {
    seedMidCombat(group);
  }
}

export type E2EHookExtension = {
  setScene: (name: string) => void;
  ready: () => Promise<void>;
};

export function attachE2EHook(bundle: SceneBundle): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('e2e') !== '1') return;

  const overlayGroup = new THREE.Group();
  overlayGroup.name = 'e2e-overlays';
  bundle.scene.add(overlayGroup);

  const ext: E2EHookExtension = {
    setScene(name: string): void {
      seedScene(name as SceneName, overlayGroup);
    },
    ready(): Promise<void> {
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    },
  };

  // Merge into window.__vylux if it already exists (from debug.ts), or create
  // a minimal shell if not (production build with ?e2e=1).
  if (window.__vylux) {
    Object.assign(window.__vylux, ext);
  } else {
    (window.__vylux as unknown as Record<string, unknown>) = ext;
  }
}
