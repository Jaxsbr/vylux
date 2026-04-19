import * as THREE from 'three';
import type { FactionId } from './placement';
import { GRID_CONSTANTS } from './grid';
import { UNIT_STATS } from './units-config';
import { buildHpBar, type HpBar } from './hp-bar';

// Convert a floating-point tile coordinate to world position without integer assertion.
function tileFloatToWorld(tx: number, ty: number): { x: number; y: number; z: number } {
  const { tileSize, worldExtent } = GRID_CONSTANTS;
  const offset = -worldExtent / 2 + tileSize / 2;
  return { x: offset + tx * tileSize, y: 0, z: offset + ty * tileSize };
}

// Faction emissive colours — same palette as HQ.
const FACTION_EMISSIVE: Record<FactionId, number> = {
  blue: 0x00e0ff,
  red: 0xff4a1a,
};

const BODY_COLOR = 0x0d1117;

// Movement speed in tiles per second.
export const WORKER_SPEED = 2;

// Geometry constants for the diamond-prism worker mesh.
// Shape: a low, wide octahedron-like diamond — narrow at top and bottom,
// widest in the middle — scaled to fit comfortably on one tile.
const WORKER_CONSTANTS = {
  // CylinderGeometry(radiusTop, radiusBottom, height, radialSegments) for each half.
  // Two halves make the diamond: top half tapers to a point, bottom half to a point.
  // Achieved with a single CylinderGeometry of 4 segments (rhombus cross-section).
  diamondRadiusTop: 0.0,
  diamondRadiusBottom: 0.28,
  diamondHeight: 0.22,
  diamondRadialSegments: 4,
  // Stacked: lower half flipped to create the bottom point.
  // Total height ~ 0.44, sits at Y=0.22 so base is ~0 and apex is ~0.44.
  bodyY: 0.22,
  emissiveIntensity: 1.2,
} as const;

export type WorkerBundle = {
  /** The Three.js group for this worker. Add to scene. */
  mesh: THREE.Group;
  faction: FactionId;
  /** Current integer tile position. */
  tileX: number;
  tileY: number;
  /** Target tile for movement (same as current when idle). */
  targetTileX: number;
  targetTileY: number;
  /** Move worker toward target each frame. dt in seconds. */
  tick: (dt: number) => void;
  /** Command the worker to move to the given tile. */
  moveTo: (tileX: number, tileY: number) => void;
  /** Teleport the worker to the given tile instantly. */
  setTile: (tileX: number, tileY: number) => void;
  /** Selection ring mesh — shown when selected. */
  selectionRing: THREE.Mesh;
  /** Current HP. */
  hp: number;
  /** Maximum HP. */
  maxHp: number;
  /** HP bar group (billboarded each frame by main.ts). */
  hpBar: HpBar;
  /** Apply damage. Returns { died, damageDealt }. */
  takeDamage: (amount: number) => { died: boolean; damageDealt: number };
  /** Remove mesh from scene and dispose geometries/materials. */
  dispose: (scene: THREE.Scene) => void;
};

function clampTile(v: number): number {
  return Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, Math.round(v)));
}

function buildDiamondMesh(emissiveHex: number): THREE.Group {
  const group = new THREE.Group();

  // Upper half — top cone, wide base pointing down.
  const upperGeo = new THREE.CylinderGeometry(
    WORKER_CONSTANTS.diamondRadiusTop,
    WORKER_CONSTANTS.diamondRadiusBottom,
    WORKER_CONSTANTS.diamondHeight,
    WORKER_CONSTANTS.diamondRadialSegments,
  );
  // Lower half — bottom cone, wide base at top (pointing down to a tip).
  const lowerGeo = new THREE.CylinderGeometry(
    WORKER_CONSTANTS.diamondRadiusBottom,
    WORKER_CONSTANTS.diamondRadiusTop,
    WORKER_CONSTANTS.diamondHeight,
    WORKER_CONSTANTS.diamondRadialSegments,
  );

  const mat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    emissive: emissiveHex,
    emissiveIntensity: WORKER_CONSTANTS.emissiveIntensity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  const upper = new THREE.Mesh(upperGeo, mat);
  upper.position.y = WORKER_CONSTANTS.diamondHeight / 2;
  upper.name = 'worker-upper';

  const lower = new THREE.Mesh(lowerGeo, mat);
  lower.position.y = -WORKER_CONSTANTS.diamondHeight / 2;
  lower.name = 'worker-lower';

  // Edge trim on the combined shape — use upper cone edges for the silhouette.
  const upperEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(upperGeo),
    new THREE.LineBasicMaterial({ color: emissiveHex }),
  );
  upperEdges.position.y = WORKER_CONSTANTS.diamondHeight / 2;
  upperEdges.name = 'worker-trim-upper';

  const lowerEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(lowerGeo),
    new THREE.LineBasicMaterial({ color: emissiveHex }),
  );
  lowerEdges.position.y = -WORKER_CONSTANTS.diamondHeight / 2;
  lowerEdges.name = 'worker-trim-lower';

  group.add(upper, lower, upperEdges, lowerEdges);
  // Center the diamond so its equator is at Y=0 relative to group origin.
  // The group origin will be placed at the tile's world Y.
  group.position.y = WORKER_CONSTANTS.bodyY;

  return group;
}

function buildSelectionRing(emissiveHex: number): THREE.Mesh {
  // Thin torus ring on the ground plane under the worker.
  const ringGeo = new THREE.RingGeometry(0.32, 0.42, 32);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: emissiveHex,
    emissiveIntensity: 1.5,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01; // just above tile plane
  ring.name = 'worker-selection-ring';
  ring.visible = false;
  return ring;
}

export function buildWorker(faction: FactionId, tileX: number, tileY: number): WorkerBundle {
  const emissive = FACTION_EMISSIVE[faction];
  const group = new THREE.Group();
  group.name = `worker-${faction}`;

  const diamond = buildDiamondMesh(emissive);
  const selectionRing = buildSelectionRing(emissive);

  const hpBar = buildHpBar(faction, 0.7);
  hpBar.group.visible = false;
  group.add(diamond, selectionRing, hpBar.group);

  const world = tileFloatToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);

  // Internal floating-point position for smooth movement.
  let posX = tileX;
  let posY = tileY;
  let targetX = tileX;
  let targetY = tileY;

  const maxHp = UNIT_STATS.worker.maxHp;

  const bundle: WorkerBundle = {
    mesh: group,
    faction,
    tileX,
    tileY,
    targetTileX: tileX,
    targetTileY: tileY,
    selectionRing,
    hp: maxHp,
    maxHp,
    hpBar,

    takeDamage(amount: number): { died: boolean; damageDealt: number } {
      const before = bundle.hp;
      bundle.hp = Math.max(0, bundle.hp - amount);
      const damageDealt = before - bundle.hp;
      hpBar.update(bundle.hp, bundle.maxHp);
      hpBar.group.visible = bundle.hp < bundle.maxHp;
      return { died: bundle.hp <= 0, damageDealt };
    },

    dispose(scene: THREE.Scene): void {
      scene.remove(group);
      group.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    },

    tick(dt: number): void {
      const dx = targetX - posX;
      const dy = targetY - posY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.001) {
        posX = targetX;
        posY = targetY;
        bundle.tileX = Math.round(targetX);
        bundle.tileY = Math.round(targetY);
        bundle.targetTileX = bundle.tileX;
        bundle.targetTileY = bundle.tileY;
      } else {
        const step = WORKER_SPEED * dt;
        const t = Math.min(step / dist, 1);
        posX += dx * t;
        posY += dy * t;
        // Update public tile as nearest integer while moving.
        bundle.tileX = clampTile(posX);
        bundle.tileY = clampTile(posY);
      }
      const clampedX = Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, posX));
      const clampedY = Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, posY));
      const w = tileFloatToWorld(clampedX, clampedY);
      group.position.set(w.x, w.y, w.z);
    },

    moveTo(tx: number, ty: number): void {
      const cx = Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, tx));
      const cy = Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, ty));
      targetX = cx;
      targetY = cy;
      bundle.targetTileX = cx;
      bundle.targetTileY = cy;
    },

    setTile(tx: number, ty: number): void {
      const cx = clampTile(tx);
      const cy = clampTile(ty);
      posX = cx;
      posY = cy;
      targetX = cx;
      targetY = cy;
      bundle.tileX = cx;
      bundle.tileY = cy;
      bundle.targetTileX = cx;
      bundle.targetTileY = cy;
      const w = tileFloatToWorld(cx, cy);
      group.position.set(w.x, w.y, w.z);
    },
  };

  return bundle;
}
