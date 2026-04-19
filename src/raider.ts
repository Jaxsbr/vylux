import * as THREE from 'three';
import type { FactionId } from './placement';
import { GRID_CONSTANTS } from './grid';

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
  emissiveIntensity: 1.2,
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
};

function clampTile(v: number): number {
  return Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, Math.round(v)));
}

function buildRaiderMesh(emissiveHex: number): THREE.Group {
  const group = new THREE.Group();

  const mat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    emissive: emissiveHex,
    emissiveIntensity: RAIDER_CONSTANTS.emissiveIntensity,
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

  group.add(blade, bladeEdges, spike, spikeEdges);
  return group;
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

  const raiderMesh = buildRaiderMesh(emissive);
  const selectionRing = buildSelectionRing(emissive);

  group.add(raiderMesh, selectionRing);

  const world = tileFloatToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);

  let posX = tileX;
  let posY = tileY;
  let targetX = tileX;
  let targetY = tileY;

  const bundle: RaiderBundle = {
    mesh: group,
    faction,
    tileX,
    tileY,
    targetTileX: tileX,
    targetTileY: tileY,
    selectionRing,

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
  };

  return bundle;
}
