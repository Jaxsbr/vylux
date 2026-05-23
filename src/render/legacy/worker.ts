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
import { buildSelectionRing } from '../entity-chrome';

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

// Phase C.5 — worker silhouette: a hovering hex-courier / harvester drone.
// Shape: a wide flat hexagonal hull (a saucer deck) with a bright core
// canopy on top and an underbelly that tapers to a small thruster pad, so it
// reads as a small craft floating above the grid. Hexagonal (6 segments, not
// the old 4-sided rhombus) so it reads as a manufactured drone — and crucially
// distinct from the 4-sided gold energy-node spike it used to echo. The dark
// hull + faction-bright edges + glowing core carry the Tron read; the harvest
// buffer shows as a halo ring at the hull's widest point. The mesh never
// rotates to heading, so the silhouette is kept radially symmetric.
const WORKER_CONSTANTS = {
  // Hexagonal cross-section for every hull piece — the "manufactured craft" read.
  segments: 6,
  // Upper hull deck — wide base, narrower flat top. CylinderGeometry(top, bottom, height, segs).
  deckRadiusTop: 0.16,
  deckRadiusBottom: 0.30,
  deckHeight: 0.14,
  // Lower underbelly — tapers from the equator down to a small thruster pad,
  // giving the "this hovers" read (no flat footprint like the grounded buildings).
  bellyRadiusTop: 0.30,
  bellyRadiusBottom: 0.10,
  bellyHeight: 0.16,
  // Bright core canopy on the deck — the faction bloom anchor (the "energy
  // cell"), bright like the work-pod cap / spire finial so the worker has a
  // focal glow even at rest.
  coreRadiusTop: 0.10,
  coreRadiusBottom: 0.13,
  coreHeight: 0.09,
  coreEmissiveIntensity: 2.0,
  // Body emissive near-zero: dark silhouette reads through; edges + core carry faction.
  bodyEmissiveIntensity: 0.05,
  // Resting lift: the equator sits at local y=0; the underbelly reaches local
  // y=-bellyHeight (-0.16). bodyY just clears that so the courier hovers a
  // touch above the floor even at the bottom of the idle-hover cycle.
  bodyY: 0.19,
  // Harvest buffer fill ring — a halo at the hull's widest point (the equator,
  // local y=0).
  fillRingInner: 0.33,
  fillRingOuter: 0.45,
  fillRingY: 0.0,
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

type WorkerMeshResult = {
  group: THREE.Group;
  fillRingMat: THREE.MeshStandardMaterial;
};

function buildCourierMesh(emissiveHex: number): WorkerMeshResult {
  const C = WORKER_CONSTANTS;
  const group = new THREE.Group();
  // Named so the Phase C.4 idle hover can grab + bob just the body, leaving
  // the selection ring + chrome on the floor.
  group.name = 'worker-body';

  // Shared dark hull material for the deck + underbelly. Near-black with a
  // whisper of emissive — the dark silhouette reads through; the edges + the
  // bright core carry the faction colour. meshes.ts pins the move-glow ramp to
  // the named 'worker-upper' mesh's material, so deck + belly energise together
  // while moving.
  const hullMat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    emissive: emissiveHex,
    emissiveIntensity: C.bodyEmissiveIntensity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  // Upper hull deck — wide base, narrower flat top. Sits above the equator
  // (local y in [0, deckHeight]). Named 'worker-upper' for the move-glow grab.
  const deckGeo = new THREE.CylinderGeometry(
    C.deckRadiusTop, C.deckRadiusBottom, C.deckHeight, C.segments,
  );
  const deck = new THREE.Mesh(deckGeo, hullMat);
  deck.position.y = C.deckHeight / 2;
  deck.name = 'worker-upper';

  // Lower underbelly — tapers from the equator down to a small thruster pad
  // (local y in [-bellyHeight, 0]).
  const bellyGeo = new THREE.CylinderGeometry(
    C.bellyRadiusTop, C.bellyRadiusBottom, C.bellyHeight, C.segments,
  );
  const belly = new THREE.Mesh(bellyGeo, hullMat);
  belly.position.y = -C.bellyHeight / 2;
  belly.name = 'worker-lower';

  // Faction-bright edge trim on both hull pieces — defines the saucer
  // silhouette and gives the bloom pass something to halo.
  const deckEdges = buildGlowEdges(new THREE.EdgesGeometry(deckGeo), emissiveHex, 'worker-trim-upper');
  deckEdges.position.y = C.deckHeight / 2;
  const bellyEdges = buildGlowEdges(new THREE.EdgesGeometry(bellyGeo), emissiveHex, 'worker-trim-lower');
  bellyEdges.position.y = -C.bellyHeight / 2;

  // Bright core canopy on the deck — the "energy cell" focal glow.
  const coreGeo = new THREE.CylinderGeometry(
    C.coreRadiusTop, C.coreRadiusBottom, C.coreHeight, C.segments,
  );
  const coreMat = new THREE.MeshStandardMaterial({
    color: emissiveHex,
    emissive: emissiveHex,
    emissiveIntensity: C.coreEmissiveIntensity,
  });
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.position.y = C.deckHeight + C.coreHeight / 2;
  core.name = 'worker-core';

  // Harvest buffer fill ring — a horizontal halo at the hull's widest point
  // that grows in opacity + emissive as the harvest buffer fills up.
  const fillRingGeo = new THREE.RingGeometry(C.fillRingInner, C.fillRingOuter, 24);
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
  fillRing.position.y = C.fillRingY;
  fillRing.name = 'worker-fill-ring';

  group.add(deck, belly, core, deckEdges, bellyEdges, fillRing);
  group.position.y = C.bodyY;

  return { group, fillRingMat };
}

export function buildWorker(faction: FactionId, tileX: number, tileY: number): WorkerBundle {
  const emissive = FACTION_EMISSIVE[faction];
  const group = new THREE.Group();
  group.name = `worker-${faction}`;

  const { group: body, fillRingMat } = buildCourierMesh(emissive);
  const selectionRing = buildSelectionRing(faction, 'unit');

  const hpBar = buildHpBar(faction, 0.7);
  hpBar.group.visible = false;
  group.add(body, selectionRing, hpBar.group);

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
