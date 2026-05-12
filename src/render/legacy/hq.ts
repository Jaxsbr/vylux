import * as THREE from 'three';
import type { FactionId } from './placement';
import { tileToWorld } from './grid';
import { HQ_MAX_HP } from './units-config';
import { buildHpBar, type HpBar } from './hp-bar';
import { eventPulseIntensity, DAMAGE_PULSE_DURATION, DAMAGE_PULSE_PEAK_DELTA } from './event-pulse';

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
  // Body emissive intensity is near-zero so the dark silhouette reads through.
  // Faction identity comes from EdgesGeometry trim lines + the accent cap below.
  bodyEmissiveIntensity: 0.05,
  // Accent cap sits atop the mid-tier: a thin luminous strip that gives bloom
  // a bright anchor without washing the body.
  accentCapW: 0.64,
  accentCapH: 0.04,
  accentCapY: 0.72,
  accentEmissiveIntensity: 2.0,
} as const;

/** Build one tier of the HQ: a dark box body with neon EdgesGeometry trim. */
function buildTier(
  width: number,
  height: number,
  centerY: number,
  emissiveHex: number,
): THREE.Group {
  const group = new THREE.Group();

  const geo = new THREE.BoxGeometry(width, height, width);
  // Body is near-black with a whisper emissive (faction colour stored for debug/Playwright,
  // but intensity near-zero so it reads as a dark silhouette, not a glowing cube).
  const mat = new THREE.MeshStandardMaterial({
    color: BODY_COLOR,
    emissive: emissiveHex,
    emissiveIntensity: HQ_CONSTANTS.bodyEmissiveIntensity,
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

/**
 * Thin luminous accent cap strip that sits atop the mid-tier.
 * Provides a bright bloom anchor in faction colour without washing the body silhouette.
 */
function buildAccentCap(emissiveHex: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(
    HQ_CONSTANTS.accentCapW,
    HQ_CONSTANTS.accentCapH,
    HQ_CONSTANTS.accentCapW,
  );
  const mat = new THREE.MeshStandardMaterial({
    color: emissiveHex,
    emissive: emissiveHex,
    emissiveIntensity: HQ_CONSTANTS.accentEmissiveIntensity,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  const cap = new THREE.Mesh(geo, mat);
  cap.position.y = HQ_CONSTANTS.accentCapY;
  cap.name = 'hq-accent-cap';
  return cap;
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
  /** Fire the damage-taken emissive flash on each hit. Called by combat.ts. */
  triggerDamagePulse: () => void;
  tickDamagePulse: (dt: number) => void;
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
  // Accent cap: thin bright strip between mid and spire tiers — the primary bloom source.
  const accentCap = buildAccentCap(emissive);
  group.add(accentCap);
  // Keep a reference to the accent cap material for damage pulse.
  const accentCapMat = accentCap.material as THREE.MeshStandardMaterial;

  const selectionRing = buildHQSelectionRing(emissive);
  group.add(selectionRing);

  // Selection-only HP bar; SimRenderer.applyInputVisuals shows it when
  // the HQ is selected.
  const hpBar = buildHpBar(faction, 2.1);
  hpBar.group.visible = false;
  group.add(hpBar.group);

  const world = tileToWorld(tileX, tileY);
  group.position.set(world.x, world.y, world.z);

  const maxHp = HQ_MAX_HP;

  let damagePulseElapsedInternal = -1;

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

    triggerDamagePulse(): void {
      damagePulseElapsedInternal = 0;
    },

    tickDamagePulse(dt: number): void {
      if (damagePulseElapsedInternal < 0) return;
      damagePulseElapsedInternal += dt;
      accentCapMat.emissiveIntensity = eventPulseIntensity(
        HQ_CONSTANTS.accentEmissiveIntensity,
        DAMAGE_PULSE_PEAK_DELTA,
        damagePulseElapsedInternal,
        DAMAGE_PULSE_DURATION,
      );
      if (damagePulseElapsedInternal >= DAMAGE_PULSE_DURATION) {
        damagePulseElapsedInternal = -1;
        accentCapMat.emissiveIntensity = HQ_CONSTANTS.accentEmissiveIntensity;
      }
    },
  };

  return bundle;
}
