import * as THREE from 'three';
import type { FactionId } from './placement';
import { GRID_CONSTANTS } from './grid';
import { UNIT_STATS } from './units-config';
import { buildHpBar, type HpBar } from './hp-bar';
import {
  placementPulseScale,
  PLACEMENT_PULSE_DURATION,
  PLACEMENT_PULSE_SCALE_START,
  DEATH_PULSE_DURATION,
} from './event-pulse';
import { buildGlowEdges } from '../glow-edge';

// Monotonically-increasing ID counter for worker identity in task system.
let _nextWorkerId = 1;
function nextWorkerId(): string {
  return `w${_nextWorkerId++}`;
}

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
  // Body emissive near-zero: dark silhouette reads through; edges carry faction.
  bodyEmissiveIntensity: 0.05,
  // Harvest buffer fill ring — sits at the equator just above the body.
  fillRingInner: 0.34,
  fillRingOuter: 0.46,
  fillRingY: 0.25,
} as const;

export type WorkerBundle = {
  /** The Three.js group for this worker. Add to scene. */
  mesh: THREE.Group;
  faction: FactionId;
  /** Unique identity string used by the worker task system. */
  id: string;
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
  /**
   * Fire the placement scale-in pulse. Call once when the unit is first spawned
   * (not on initial scene load — only on trainUnit).
   */
  triggerPlacementPulse: () => void;
  /**
   * Advance the placement-pulse animation. Call every frame with the frame delta.
   */
  tickPlacementPulse: (dt: number) => void;
  /**
   * Read-only: seconds elapsed since placement pulse fired, or -1 when not active.
   */
  readonly placementPulseElapsed: number;
  /**
   * Fire the death emissive spike. Call when hp <= 0, BEFORE dispose.
   * The unit will not call dispose itself — the caller must tick tickDeathPulse
   * and dispose when deathPulseActive returns false.
   */
  triggerDeathPulse: () => void;
  /**
   * Advance the death-pulse animation. Returns true while pulse is active, false
   * when the pulse has finished and the unit is ready to be disposed.
   */
  tickDeathPulse: (dt: number) => boolean;
  /**
   * Read-only: true while death pulse is running.
   */
  readonly deathPulseActive: boolean;

  /**
   * Set the harvest buffer fill progress (0–1). Drives a visible ring on
   * the worker mesh that reads as "filling up" during the harvesting phase.
   * Pass 0 to hide the fill ring.
   */
  setHarvestFill: (progress: number) => void;
  /**
   * Read-only: current harvest fill progress (0–1).
   */
  readonly harvestFillProgress: number;
};

function clampTile(v: number): number {
  return Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, Math.round(v)));
}

type DiamondMeshResult = {
  group: THREE.Group;
  fillRingMat: THREE.MeshStandardMaterial;
};

function buildDiamondMesh(emissiveHex: number): DiamondMeshResult {
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

  // Body is near-black with whisper emissive — dark silhouette; edges + accent carry faction.
  const mat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    emissive: emissiveHex,
    emissiveIntensity: WORKER_CONSTANTS.bodyEmissiveIntensity,
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
  const upperEdges = buildGlowEdges(new THREE.EdgesGeometry(upperGeo), emissiveHex, 'worker-trim-upper');
  upperEdges.position.y = WORKER_CONSTANTS.diamondHeight / 2;

  const lowerEdges = buildGlowEdges(new THREE.EdgesGeometry(lowerGeo), emissiveHex, 'worker-trim-lower');
  lowerEdges.position.y = -WORKER_CONSTANTS.diamondHeight / 2;

  // Harvest buffer fill ring — sits at the worker's equator and grows in
  // opacity + emissive as the harvest buffer fills up.
  const fillRingGeo = new THREE.RingGeometry(
    WORKER_CONSTANTS.fillRingInner,
    WORKER_CONSTANTS.fillRingOuter,
    20,
  );
  const fillRingMat = new THREE.MeshStandardMaterial({
    color: emissiveHex,
    emissive: emissiveHex,
    emissiveIntensity: 0,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0,
  });
  const fillRing = new THREE.Mesh(fillRingGeo, fillRingMat);
  fillRing.rotation.x = -Math.PI / 2;
  fillRing.position.y = WORKER_CONSTANTS.fillRingY;
  fillRing.name = 'worker-fill-ring';

  group.add(upper, lower, upperEdges, lowerEdges, fillRing);
  group.position.y = WORKER_CONSTANTS.bodyY;

  return { group, fillRingMat };
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

  const { group: diamond, fillRingMat } = buildDiamondMesh(emissive);
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

  // Placement pulse state.
  let placementPulseElapsedInternal = -1;

  // Death pulse state.
  let deathPulseElapsedInternal = -1;
  let deathPulseActiveInternal = false;

  // Harvest fill progress (0–1).
  let harvestFillProgressInternal = 0;

  const maxHp = UNIT_STATS.worker.maxHp;
  const workerId = nextWorkerId();

  const bundle: WorkerBundle = {
    mesh: group,
    faction,
    id: workerId,
    tileX,
    tileY,
    targetTileX: tileX,
    targetTileY: tileY,
    selectionRing,
    hp: maxHp,
    maxHp,
    hpBar,
    get placementPulseElapsed(): number { return placementPulseElapsedInternal; },
    get deathPulseActive(): boolean { return deathPulseActiveInternal; },
    get harvestFillProgress(): number { return harvestFillProgressInternal; },

    setHarvestFill(progress: number): void {
      harvestFillProgressInternal = Math.max(0, Math.min(1, progress));
      if (harvestFillProgressInternal < 0.01) {
        fillRingMat.opacity = 0;
        fillRingMat.emissiveIntensity = 0;
      } else {
        // Pulse the fill ring opacity + emissive with progress.
        fillRingMat.opacity = 0.15 + harvestFillProgressInternal * 0.75;
        fillRingMat.emissiveIntensity = 0.5 + harvestFillProgressInternal * 2.5;
      }
    },

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

    triggerPlacementPulse(): void {
      placementPulseElapsedInternal = 0;
      // Set initial scale to scaleStart immediately.
      const s = PLACEMENT_PULSE_SCALE_START;
      group.scale.set(s, s, s);
    },

    tickPlacementPulse(dt: number): void {
      if (placementPulseElapsedInternal < 0) return;
      placementPulseElapsedInternal += dt;
      const s = placementPulseScale(placementPulseElapsedInternal, PLACEMENT_PULSE_DURATION, PLACEMENT_PULSE_SCALE_START);
      group.scale.set(s, s, s);
      if (placementPulseElapsedInternal >= PLACEMENT_PULSE_DURATION) {
        placementPulseElapsedInternal = -1;
        group.scale.set(1, 1, 1);
      }
    },

    triggerDeathPulse(): void {
      deathPulseElapsedInternal = 0;
      deathPulseActiveInternal = true;
    },

    tickDeathPulse(dt: number): boolean {
      if (!deathPulseActiveInternal) return false;
      deathPulseElapsedInternal += dt;
      if (deathPulseElapsedInternal >= DEATH_PULSE_DURATION) {
        deathPulseActiveInternal = false;
        return false;
      }
      return true;
    },
  };

  return bundle;
}
