import * as THREE from 'three';
import type { FactionId } from './placement';
import { tileToWorld } from './grid';
import { HQ_MAX_HP } from './units-config';
import { buildHpBar, type HpBar } from './hp-bar';

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
  /** Alias for group — used by combat.ts which expects mesh.position. */
  mesh: { position: THREE.Vector3 };
  faction: FactionId;
  tileX: number;
  tileY: number;
  /** Selection ring rendered under the HQ tile — shown when selected. */
  selectionRing: THREE.Mesh;
  hp: number;
  maxHp: number;
  hpBar: HpBar;
  /** Fractional damage accumulator for scoring floor(total/10) points. */
  damageAccumulator: number;
  takeDamage: (amount: number) => { died: boolean; damageDealt: number };
};

function buildHQSelectionRing(emissiveHex: number): THREE.Mesh {
  // Larger ring under the HQ — same cyan style as worker ring.
  const ringGeo = new THREE.RingGeometry(0.48, 0.60, 32);
  const ringMat = new THREE.MeshStandardMaterial({
    color: 0x00e5ff,
    emissive: emissiveHex,
    emissiveIntensity: 1.5,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  ring.name = 'hq-selection-ring';
  ring.visible = false;
  return ring;
}

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

  const selectionRing = buildHQSelectionRing(emissive);
  group.add(selectionRing);

  // HP bar — always visible on HQs.
  const hpBar = buildHpBar(faction, 2.1);
  hpBar.group.visible = true;
  group.add(hpBar.group);

  const world = tileToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);

  const maxHp = HQ_MAX_HP;

  const bundle: HQBundle = {
    group,
    mesh: group,
    faction,
    tileX,
    tileY,
    selectionRing,
    hp: maxHp,
    maxHp,
    hpBar,
    damageAccumulator: 0,

    takeDamage(amount: number): { died: boolean; damageDealt: number } {
      const before = bundle.hp;
      bundle.hp = Math.max(0, bundle.hp - amount);
      const damageDealt = before - bundle.hp;
      hpBar.update(bundle.hp, bundle.maxHp);
      return { died: bundle.hp <= 0, damageDealt };
    },
  };

  return bundle;
}
