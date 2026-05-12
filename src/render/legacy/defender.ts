import * as THREE from 'three';
import type { FactionId } from './placement';
import { GRID_CONSTANTS } from './grid';
import { UNIT_STATS } from './units-config';
import { buildHpBar, type HpBar } from './hp-bar';
import {
  placementPulseScale,
  PLACEMENT_PULSE_DURATION,
  PLACEMENT_PULSE_SCALE_START,
  eventPulseIntensity,
  DEATH_PULSE_DURATION,
  DEATH_PULSE_PEAK_DELTA,
  DAMAGE_PULSE_DURATION,
  DAMAGE_PULSE_PEAK_DELTA,
} from './event-pulse';
import { buildGlowEdges } from '../glow-edge';

function tileFloatToWorld(tx: number, ty: number): { x: number; y: number; z: number } {
  const { tileSize, worldExtent } = GRID_CONSTANTS;
  const offset = -worldExtent / 2 + tileSize / 2;
  return { x: offset + tx * tileSize, y: 0, z: offset + ty * tileSize };
}

const FACTION_EMISSIVE: Record<FactionId, number> = {
  blue: 0x00e0ff,
  red: 0xff4a1a,
};

const BODY_COLOR = 0x0d1117;

// Defender speed in tiles per second — squat tank, slow.
export const DEFENDER_SPEED = 1.2;

// Geometry: squat octagonal prism — wider and shorter than the worker diamond.
// CylinderGeometry with 8 radial segments reads as hexagonal/octagonal from
// the isometric camera, giving a "heavy shield" silhouette.
const DEF_CONSTANTS = {
  radiusTop: 0.38,
  radiusBottom: 0.38,
  height: 0.28,
  radialSegments: 8,
  bodyY: 0.14,
  capRadius: 0.22,
  capHeight: 0.12,
  capY: 0.28,
  // Body emissive near-zero: dark silhouette; edges + accent strip carry faction identity.
  bodyEmissiveIntensity: 0.05,
  // Thin accent strip around the body mid-height — the bright bloom anchor.
  accentStripRadius: 0.40,
  accentStripHeight: 0.03,
  accentStripY: 0.14,
  accentEmissiveIntensity: 2.0,
} as const;

export type DefenderBundle = {
  mesh: THREE.Group;
  faction: FactionId;
  tileX: number;
  tileY: number;
  targetTileX: number;
  targetTileY: number;
  tick: (dt: number) => void;
  moveTo: (tileX: number, tileY: number) => void;
  setTile: (tileX: number, tileY: number) => void;
  selectionRing: THREE.Mesh;
  hp: number;
  maxHp: number;
  hpBar: HpBar;
  attackCooldownRemaining: number;
  takeDamage: (amount: number) => { died: boolean; damageDealt: number };
  dispose: (scene: THREE.Scene) => void;
  triggerPlacementPulse: () => void;
  tickPlacementPulse: (dt: number) => void;
  readonly placementPulseElapsed: number;
  triggerDeathPulse: () => void;
  tickDeathPulse: (dt: number) => boolean;
  readonly deathPulseActive: boolean;
  /** Fire the damage-taken emissive flash. Called by combat.ts on each hit. */
  triggerDamagePulse: () => void;
  tickDamagePulse: (dt: number) => void;
  /** Unique numeric id for this defender — used for raider retaliation tracking. */
  readonly unitId: number;
};

function clampTile(v: number): number {
  return Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, Math.round(v)));
}

// Monotonically-increasing id for defender units — used for raider retaliation tracking.
let _nextDefenderId = 1;
function nextDefenderId(): number {
  return _nextDefenderId++;
}

type DefenderMeshResult = { group: THREE.Group; accentMat: THREE.MeshStandardMaterial };

function buildDefenderMesh(emissiveHex: number): DefenderMeshResult {
  const group = new THREE.Group();

  // Main squat body — wide octagonal prism.
  const bodyGeo = new THREE.CylinderGeometry(
    DEF_CONSTANTS.radiusTop,
    DEF_CONSTANTS.radiusBottom,
    DEF_CONSTANTS.height,
    DEF_CONSTANTS.radialSegments,
  );
  // Body is near-black with whisper emissive — dark silhouette; edges + accent carry faction.
  const mat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    emissive: emissiveHex,
    emissiveIntensity: DEF_CONSTANTS.bodyEmissiveIntensity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const body = new THREE.Mesh(bodyGeo, mat);
  body.position.y = DEF_CONSTANTS.bodyY;
  body.name = 'defender-body';

  const bodyEdges = buildGlowEdges(new THREE.EdgesGeometry(bodyGeo), emissiveHex, 'defender-body-trim');
  bodyEdges.position.y = DEF_CONSTANTS.bodyY;

  // Narrow cap on top — reinforces "armoured dome" read.
  const capGeo = new THREE.CylinderGeometry(
    0,
    DEF_CONSTANTS.capRadius,
    DEF_CONSTANTS.capHeight,
    DEF_CONSTANTS.radialSegments,
  );
  const cap = new THREE.Mesh(capGeo, mat);
  cap.position.y = DEF_CONSTANTS.capY + DEF_CONSTANTS.capHeight / 2;
  cap.name = 'defender-cap';

  const capEdges = buildGlowEdges(new THREE.EdgesGeometry(capGeo), emissiveHex, 'defender-cap-trim');
  capEdges.position.y = DEF_CONSTANTS.capY + DEF_CONSTANTS.capHeight / 2;

  // Accent strip around the body equator — thin bright ring; primary bloom source.
  const accentGeo = new THREE.CylinderGeometry(
    DEF_CONSTANTS.accentStripRadius,
    DEF_CONSTANTS.accentStripRadius,
    DEF_CONSTANTS.accentStripHeight,
    DEF_CONSTANTS.radialSegments,
  );
  const accentMat = new THREE.MeshStandardMaterial({
    color: emissiveHex,
    emissive: emissiveHex,
    emissiveIntensity: DEF_CONSTANTS.accentEmissiveIntensity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const accentStrip = new THREE.Mesh(accentGeo, accentMat);
  accentStrip.position.y = DEF_CONSTANTS.accentStripY;
  accentStrip.name = 'defender-accent-strip';

  group.add(body, bodyEdges, cap, capEdges, accentStrip);
  return { group, accentMat };
}

function buildSelectionRing(emissiveHex: number): THREE.Mesh {
  const ringGeo = new THREE.RingGeometry(0.42, 0.52, 32);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: emissiveHex,
    emissiveIntensity: 1.5,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  ring.name = 'defender-selection-ring';
  ring.visible = false;
  return ring;
}

export function buildDefender(faction: FactionId, tileX: number, tileY: number): DefenderBundle {
  const emissive = FACTION_EMISSIVE[faction];
  const group = new THREE.Group();
  group.name = `defender-${faction}`;

  const { group: defMesh, accentMat } = buildDefenderMesh(emissive);
  const selectionRing = buildSelectionRing(emissive);

  const hpBar = buildHpBar(faction, 0.75);
  hpBar.group.visible = false;
  group.add(defMesh, selectionRing, hpBar.group);

  const world = tileFloatToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);

  let posX = tileX;
  let posY = tileY;
  let targetX = tileX;
  let targetY = tileY;

  let placementPulseElapsedInternal = -1;
  let deathPulseElapsedInternal = -1;
  let deathPulseActiveInternal = false;
  let damagePulseElapsedInternal = -1;
  const defenderUnitId = nextDefenderId();

  const maxHp = UNIT_STATS.defender.maxHp;

  const bundle: DefenderBundle = {
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
    attackCooldownRemaining: 0,
    unitId: defenderUnitId,
    get placementPulseElapsed(): number { return placementPulseElapsedInternal; },
    get deathPulseActive(): boolean { return deathPulseActiveInternal; },

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
        const step = DEFENDER_SPEED * dt;
        const t = Math.min(step / dist, 1);
        posX += dx * t;
        posY += dy * t;
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
      accentMat.emissiveIntensity = eventPulseIntensity(
        DEF_CONSTANTS.accentEmissiveIntensity,
        DEATH_PULSE_PEAK_DELTA,
        deathPulseElapsedInternal,
        DEATH_PULSE_DURATION,
      );
      if (deathPulseElapsedInternal >= DEATH_PULSE_DURATION) {
        deathPulseActiveInternal = false;
        accentMat.emissiveIntensity = DEF_CONSTANTS.accentEmissiveIntensity;
        return false;
      }
      return true;
    },

    triggerDamagePulse(): void {
      damagePulseElapsedInternal = 0;
    },

    tickDamagePulse(dt: number): void {
      if (damagePulseElapsedInternal < 0) return;
      damagePulseElapsedInternal += dt;
      accentMat.emissiveIntensity = eventPulseIntensity(
        DEF_CONSTANTS.accentEmissiveIntensity,
        DAMAGE_PULSE_PEAK_DELTA,
        damagePulseElapsedInternal,
        DAMAGE_PULSE_DURATION,
      );
      if (damagePulseElapsedInternal >= DAMAGE_PULSE_DURATION) {
        damagePulseElapsedInternal = -1;
        accentMat.emissiveIntensity = DEF_CONSTANTS.accentEmissiveIntensity;
      }
    },
  };

  return bundle;
}
