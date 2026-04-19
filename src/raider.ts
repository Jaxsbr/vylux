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
} from './event-pulse';

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

// Raider speed in tiles per second — fast assault unit.
export const RAIDER_SPEED = 2.8;

// Geometry: elongated blade/wedge — tall, narrow, angular.
// A tapered rectangular prism (box that narrows to a blade edge at the top)
// built from two CylinderGeometry with 3 segments (triangle cross-section)
// stacked to form a pointed blade. Reads as fast/aggressive from iso camera.
const RAIDER_CONSTANTS = {
  // Lower blade body — wide triangle base
  bladeRadiusTop: 0.08,
  bladeRadiusBottom: 0.2,
  bladeHeight: 0.55,
  bladeRadialSegments: 3,
  bladeY: 0.275,
  // Upper spike — continues taper to a sharp point
  spikeRadiusTop: 0,
  spikeRadiusBottom: 0.08,
  spikeHeight: 0.32,
  spikeY: 0.55 + 0.16,
  // Body emissive near-zero: dark blade silhouette; edges + spike tip carry faction.
  bodyEmissiveIntensity: 0.05,
  // Spike tip accent — small glowing cap at the very top; bright bloom source.
  tipRadius: 0.045,
  tipHeight: 0.06,
  tipY: 0.55 + 0.32 + 0.03,
  accentEmissiveIntensity: 2.0,
} as const;

export type RaiderBundle = {
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
};

function clampTile(v: number): number {
  return Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, Math.round(v)));
}

type RaiderMeshResult = { group: THREE.Group; tipMat: THREE.MeshStandardMaterial };

function buildRaiderMesh(emissiveHex: number): RaiderMeshResult {
  const group = new THREE.Group();

  // Body is near-black with whisper emissive — dark blade silhouette; edges + tip carry faction.
  const mat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    emissive: emissiveHex,
    emissiveIntensity: RAIDER_CONSTANTS.bodyEmissiveIntensity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  // Lower triangular blade body.
  const bladeGeo = new THREE.CylinderGeometry(
    RAIDER_CONSTANTS.bladeRadiusTop,
    RAIDER_CONSTANTS.bladeRadiusBottom,
    RAIDER_CONSTANTS.bladeHeight,
    RAIDER_CONSTANTS.bladeRadialSegments,
  );
  const blade = new THREE.Mesh(bladeGeo, mat);
  blade.position.y = RAIDER_CONSTANTS.bladeY;
  blade.name = 'raider-blade';

  const bladeEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(bladeGeo),
    new THREE.LineBasicMaterial({ color: emissiveHex }),
  );
  bladeEdges.position.y = RAIDER_CONSTANTS.bladeY;
  bladeEdges.name = 'raider-blade-trim';

  // Upper spike — continues to a fine point.
  const spikeGeo = new THREE.CylinderGeometry(
    RAIDER_CONSTANTS.spikeRadiusTop,
    RAIDER_CONSTANTS.spikeRadiusBottom,
    RAIDER_CONSTANTS.spikeHeight,
    RAIDER_CONSTANTS.bladeRadialSegments,
  );
  const spike = new THREE.Mesh(spikeGeo, mat);
  spike.position.y = RAIDER_CONSTANTS.spikeY;
  spike.name = 'raider-spike';

  const spikeEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(spikeGeo),
    new THREE.LineBasicMaterial({ color: emissiveHex }),
  );
  spikeEdges.position.y = RAIDER_CONSTANTS.spikeY;
  spikeEdges.name = 'raider-spike-trim';

  // Glowing spike-tip accent — small bright cap at the very point; primary bloom source.
  const tipGeo = new THREE.SphereGeometry(RAIDER_CONSTANTS.tipRadius, 6, 6);
  const tipMat = new THREE.MeshStandardMaterial({
    color: emissiveHex,
    emissive: emissiveHex,
    emissiveIntensity: RAIDER_CONSTANTS.accentEmissiveIntensity,
  });
  const tip = new THREE.Mesh(tipGeo, tipMat);
  tip.position.y = RAIDER_CONSTANTS.tipY;
  tip.name = 'raider-tip-accent';

  group.add(blade, bladeEdges, spike, spikeEdges, tip);
  return { group, tipMat };
}

function buildSelectionRing(emissiveHex: number): THREE.Mesh {
  const ringGeo = new THREE.RingGeometry(0.25, 0.35, 32);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: emissiveHex,
    emissiveIntensity: 1.5,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  ring.name = 'raider-selection-ring';
  ring.visible = false;
  return ring;
}

export function buildRaider(faction: FactionId, tileX: number, tileY: number): RaiderBundle {
  const emissive = FACTION_EMISSIVE[faction];
  const group = new THREE.Group();
  group.name = `raider-${faction}`;

  const { group: raiderMesh, tipMat } = buildRaiderMesh(emissive);
  const selectionRing = buildSelectionRing(emissive);

  const hpBar = buildHpBar(faction, 1.2);
  hpBar.group.visible = false;
  group.add(raiderMesh, selectionRing, hpBar.group);

  const world = tileFloatToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);

  let posX = tileX;
  let posY = tileY;
  let targetX = tileX;
  let targetY = tileY;

  let placementPulseElapsedInternal = -1;
  let deathPulseElapsedInternal = -1;
  let deathPulseActiveInternal = false;

  const maxHp = UNIT_STATS.raider.maxHp;

  const bundle: RaiderBundle = {
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
        const step = RAIDER_SPEED * dt;
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
      tipMat.emissiveIntensity = eventPulseIntensity(
        RAIDER_CONSTANTS.accentEmissiveIntensity,
        DEATH_PULSE_PEAK_DELTA,
        deathPulseElapsedInternal,
        DEATH_PULSE_DURATION,
      );
      if (deathPulseElapsedInternal >= DEATH_PULSE_DURATION) {
        deathPulseActiveInternal = false;
        tipMat.emissiveIntensity = RAIDER_CONSTANTS.accentEmissiveIntensity;
        return false;
      }
      return true;
    },
  };

  return bundle;
}
