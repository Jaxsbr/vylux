import * as THREE from 'three';
import { tileToWorld } from './grid';
import type { SceneBundle } from './scene';
import type { FactionEnergy } from './economy';
import type { FactionPoints } from './points';
import type { FactionHold } from './energy-node';
import { buildWorker } from './worker';

// E2E-only hook — installed only when the URL contains `?e2e=1`.
// This file is imported by main.ts but the install function exits early unless
// the query param is present, so production builds that never pass ?e2e=1
// never run any of this logic.
//
// State-ownership: this module does NOT write to placement.ts state. It seeds
// placeholder Three.js meshes directly into a dedicated `e2e-overlays` group
// on the scene so the main reconcile loop never sees them.
//
// HQs and energy nodes are NOT seeded here — they are pre-placed by
// createScene() and are always present in the scene.

const BLUE_HEX = 0x00e5ff;
const RED_HEX = 0xff5a1f;
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

function seedIdleStart(_group: THREE.Group): void {
  // HQs, energy nodes, and starter workers are already in the scene from createScene().
  // Nothing extra to seed for idle-start.
}

function seedEarlyEconomy(group: THREE.Group, bundle: SceneBundle): void {
  seedIdleStart(group);

  // Move starter blue workers near the bottom-left node (tile 5,5).
  // Blue starters: index 0 = (1,0), index 1 = (0,1).
  if (bundle.workers[0]) bundle.workers[0].setTile(5, 5);
  if (bundle.workers[1]) bundle.workers[1].setTile(4, 5);

  // Spawn a third blue worker at (5,6).
  const blueExtra = buildWorker('blue', 5, 6);
  blueExtra.mesh.name = 'e2e-spawned-blue-worker';
  bundle.scene.add(blueExtra.mesh);
  bundle.workers.push(blueExtra);

  // Move starter red workers near the top-right node (tile 14,14).
  // Red starters: index 2 = (18,19), index 3 = (19,18).
  if (bundle.workers[2]) bundle.workers[2].setTile(14, 14);
  if (bundle.workers[3]) bundle.workers[3].setTile(13, 14);

  // Spawn a third red worker at (14,13).
  const redExtra = buildWorker('red', 14, 13);
  redExtra.mesh.name = 'e2e-spawned-red-worker';
  bundle.scene.add(redExtra.mesh);
  bundle.workers.push(redExtra);
}

function seedMidCombat(group: THREE.Group, bundle: SceneBundle): void {
  seedIdleStart(group);

  // Blue workers at their node for economy context.
  if (bundle.workers[0]) bundle.workers[0].setTile(5, 5);
  if (bundle.workers[1]) bundle.workers[1].setTile(4, 5);

  // Red workers near their HQ.
  if (bundle.workers[2]) bundle.workers[2].setTile(17, 18);
  if (bundle.workers[3]) bundle.workers[3].setTile(18, 17);

  // Blue raiders charging toward the red HQ (placeholder boxes — real raider mesh is a future task).
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

  // Red defenders near their HQ (placeholder boxes — real defender mesh is a future task).
  const redDefenderPositions: [number, number][] = [
    [17, 17],
    [18, 18],
  ];
  for (const [tx, ty] of redDefenderPositions) {
    const defender = makeBox(0.75, 0.9, RED_HEX, PLACED_Y);
    defender.name = 'e2e-red-defender';
    placeAt(defender, tx, ty);
    group.add(defender);
  }
}

function seedScene(name: SceneName, group: THREE.Group, bundle: SceneBundle): void {
  clearGroup(group);
  // Remove any extra e2e-spawned workers from previous scene.
  const spawned = bundle.workers.filter((w) => w.mesh.name.startsWith('e2e-spawned'));
  for (const w of spawned) {
    bundle.scene.remove(w.mesh);
  }
  const spawned2 = bundle.workers.filter((w) => !w.mesh.name.startsWith('e2e-spawned'));
  bundle.workers.length = 0;
  for (const w of spawned2) {
    bundle.workers.push(w);
  }

  if (name === 'idle-start') {
    seedIdleStart(group);
  } else if (name === 'early-economy') {
    seedEarlyEconomy(group, bundle);
  } else if (name === 'mid-combat') {
    seedMidCombat(group, bundle);
  }
}

export type HudSetters = {
  setEnergy: (patch: Partial<FactionEnergy>) => void;
  setPoints: (patch: Partial<FactionPoints>) => void;
};

export type E2EHookExtension = {
  setScene: (name: string) => void;
  ready: () => Promise<void>;
  setEnergy: (patch: Partial<FactionEnergy>) => void;
  setPoints: (patch: Partial<FactionPoints>) => void;
  setNodeHolds: (holds: Record<number, FactionHold>) => void;
  spawnWorker: (faction: string, tileX: number, tileY: number) => number;
  moveWorker: (index: number, tileX: number, tileY: number) => void;
  getWorkerTile: (index: number) => { tileX: number; tileY: number } | null;
};

export function attachE2EHook(bundle: SceneBundle, hudSetters: HudSetters): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('e2e') !== '1') return;

  const overlayGroup = new THREE.Group();
  overlayGroup.name = 'e2e-overlays';
  bundle.scene.add(overlayGroup);

  const ext: E2EHookExtension = {
    setScene(name: string): void {
      seedScene(name as SceneName, overlayGroup, bundle);
    },
    ready(): Promise<void> {
      return new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    },
    setEnergy: hudSetters.setEnergy,
    setPoints: hudSetters.setPoints,
    setNodeHolds(holds: Record<number, FactionHold>): void {
      for (const [indexStr, faction] of Object.entries(holds)) {
        const idx = Number(indexStr);
        const node = bundle.energyNodes[idx];
        if (node !== undefined) {
          node.setFactionHold(faction);
        }
      }
    },
    spawnWorker(faction: string, tileX: number, tileY: number): number {
      const f = faction === 'red' ? 'red' : 'blue';
      const w = buildWorker(f, tileX, tileY);
      w.mesh.name = 'e2e-spawned-' + f + '-worker';
      bundle.scene.add(w.mesh);
      bundle.workers.push(w);
      return bundle.workers.length - 1;
    },
    moveWorker(index: number, tileX: number, tileY: number): void {
      const w = bundle.workers[index];
      if (w !== undefined) {
        w.setTile(tileX, tileY);
      }
    },
    getWorkerTile(index: number): { tileX: number; tileY: number } | null {
      const w = bundle.workers[index];
      if (w === undefined) return null;
      return { tileX: w.tileX, tileY: w.tileY };
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
