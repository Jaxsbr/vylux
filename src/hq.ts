import * as THREE from 'three';
import type { FactionId } from './placement';
import { tileToWorld } from './grid';

// Faction emissive hex values — match the palette used in placement.ts ghost emissive.
const FACTION_EMISSIVE: Record<FactionId, number> = {
  blue: 0x00e0ff,
  red: 0xff4a1a,
};

// HQ body colour: near-black, so emissive glow and neon trim carry all the identity.
const BODY_COLOR = 0x0d1117;

// HQ geometry constants — tuned to read as a distinct "building" silhouette from
// the isometric 30° elevation camera without occluding the grid.
const HQ_CONSTANTS = {
  // Wide base tier
  baseW: 0.9,
  baseH: 0.35,
  baseY: 0.175,
  // Mid tier
  midW: 0.62,
  midH: 0.35,
  midY: 0.525,
  // Narrow spire
  spireW: 0.28,
  spireH: 0.55,
  spireY: 0.975,
  // Antenna — thin vertical pillar atop spire
  antennaW: 0.06,
  antennaH: 0.45,
  antennaY: 1.475,
  // Emissive intensity on the body — high enough for UnrealBloomPass to halo it.
  emissiveIntensity: 1.4,
} as const;

/** Build one tier of the HQ: a box mesh with an emissive body + neon EdgesGeometry trim. */
function buildTier(
  width: number,
  height: number,
  centerY: number,
  emissiveHex: number,
): THREE.Group {
  const group = new THREE.Group();

  const geo = new THREE.BoxGeometry(width, height, width);
  const mat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    emissive: emissiveHex,
    emissiveIntensity: HQ_CONSTANTS.emissiveIntensity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = centerY;
  mesh.name = 'hq-tier';

  const edgesGeo = new THREE.EdgesGeometry(geo);
  const edgesMat = new THREE.LineBasicMaterial({ color: emissiveHex });
  const edges = new THREE.LineSegments(edgesGeo, edgesMat);
  edges.position.y = centerY;
  edges.name = 'hq-trim';

  group.add(mesh, edges);
  return group;
}

export type HQBundle = {
  group: THREE.Group;
  faction: FactionId;
  tileX: number;
  tileY: number;
};

/**
 * Build a Tron-style HQ group at the given tile coordinate.
 *
 * Silhouette: wide base → narrower mid tier → narrow spire → thin antenna.
 * All tiers share the faction emissive colour so bloom halos the full profile.
 */
export function buildHQ(faction: FactionId, tileX: number, tileY: number): HQBundle {
  const emissive = FACTION_EMISSIVE[faction];
  const group = new THREE.Group();
  group.name = `hq-${faction}`;

  group.add(buildTier(HQ_CONSTANTS.baseW, HQ_CONSTANTS.baseH, HQ_CONSTANTS.baseY, emissive));
  group.add(buildTier(HQ_CONSTANTS.midW, HQ_CONSTANTS.midH, HQ_CONSTANTS.midY, emissive));
  group.add(buildTier(HQ_CONSTANTS.spireW, HQ_CONSTANTS.spireH, HQ_CONSTANTS.spireY, emissive));
  group.add(buildTier(HQ_CONSTANTS.antennaW, HQ_CONSTANTS.antennaH, HQ_CONSTANTS.antennaY, emissive));

  const world = tileToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);

  return { group, faction, tileX, tileY };
}
