// Canonical visual chrome for selectable entities — selection rings,
// edge trim, HP bars. Every new entity (unit, structure, resource node)
// in the game MUST source its chrome from here.
//
// Why this module exists:
// Selection rings drifted across hq.ts, worker.ts and meshes.ts —
// the structure variant ended up faction-tinted + transparent and
// failed to bloom for the red faction. Centralising the idiom in one
// place means the bloom-correct, faction-readable look is the only
// look an entity builder can construct.
//
// Conventions (read this before adding a new entity):
//
//   1. Body geometry uses a near-black `MeshStandardMaterial`
//      (`color: 0x0d1117`) with low emissive intensity and
//      `polygonOffset: true`. See worker.ts / hq.ts for examples.
//   2. Wrap each piece of body geometry in trim via
//      `buildGlowEdges(new THREE.EdgesGeometry(geo), factionColor, name)`.
//   3. Add a selection ring via `buildSelectionRing(faction, kind)`.
//      Faction is `'blue' | 'red' | null` (null for resource nodes).
//   4. Add an HP bar via `buildHpBar(faction, yOffset)`.
//   5. Return a bundle with at minimum `{ group, hpBar, selectionRing }`
//      so `SimRenderer.applyInputVisuals` can toggle them uniformly.
//
// `src/source-scan.test.ts` includes a guardrail that fails the build
// if any entity builder rolls its own RingGeometry instead of going
// through `buildSelectionRing` — so adding a new entity will refuse to
// compile until it picks up the convention.

import * as THREE from 'three';
import type { FactionId } from './legacy/placement';
import { buildGlowEdges } from './glow-edge';
import { buildHpBar, type HpBar } from './legacy/hp-bar';

// Re-exports so a new entity builder has a single import line for all
// its chrome:
//   import { buildSelectionRing, buildGlowEdges, buildHpBar } from '../entity-chrome';
export { buildGlowEdges, buildHpBar };
export type { HpBar };

export type SelectionKind = 'unit' | 'structure' | 'hq' | 'node';

// Solid cyan body. Cyan's luminance is well above the bloom threshold
// for either faction emissive, so the ring blooms regardless of which
// side owns the entity (or whether it's owned at all).
const SELECTION_BODY = 0x00e5ff;
const SELECTION_EMISSIVE_INTENSITY = 1.5;

const FACTION_EMISSIVE_HEX: Record<FactionId, number> = {
  blue: 0x00e0ff,
  red:  0xff4a1a,
};

// Default radii + ground-clearance Y per entity kind. Per-entity
// builders can override via opts when they need a tighter or wider
// footprint (e.g. pylon is smaller than a forge); the glow + colour
// parameters are not overridable so the bloom calibration stays
// consistent everywhere.
const KIND_DEFAULTS: Record<SelectionKind, { inner: number; outer: number; y: number }> = {
  unit:      { inner: 0.32, outer: 0.42, y: 0.01 },
  structure: { inner: 0.55, outer: 0.68, y: 0.02 },
  hq:        { inner: 0.48, outer: 0.60, y: 0.01 },
  node:      { inner: 0.46, outer: 0.56, y: 0.02 },
};

export interface SelectionRingOptions {
  innerRadius?: number;
  outerRadius?: number;
  yOffset?: number;
  /** Override the default ring name (default `${kind}-selection-ring`). */
  name?: string;
  /**
   * Override the emissive tint. Useful when an entity has its own
   * identity colour (e.g. an energy node should glow gold, not cyan).
   * Defaults to the faction emissive, or cyan when faction is null.
   */
  emissive?: number;
}

/**
 * Build the canonical selection ring for an entity. Returns a hidden,
 * flat ring with a cyan body and a faction emissive overlay; the
 * caller adds it to its mesh group and `SimRenderer.applyInputVisuals`
 * toggles its `.visible` flag.
 *
 * @param faction Owning faction, or `null` for unowned things (e.g.
 *                resource nodes — the ring stays pure cyan).
 * @param kind    Picks the default footprint + ground-clearance Y.
 */
export function buildSelectionRing(
  faction: FactionId | null,
  kind: SelectionKind,
  opts: SelectionRingOptions = {},
): THREE.Mesh {
  const defaults = KIND_DEFAULTS[kind];
  const inner = opts.innerRadius ?? defaults.inner;
  const outer = opts.outerRadius ?? defaults.outer;
  const y = opts.yOffset ?? defaults.y;
  const emissive = opts.emissive
    ?? (faction === null ? SELECTION_BODY : FACTION_EMISSIVE_HEX[faction]);

  const geo = new THREE.RingGeometry(inner, outer, 32);
  const mat = new THREE.MeshStandardMaterial({
    color: SELECTION_BODY,
    emissive,
    emissiveIntensity: SELECTION_EMISSIVE_INTENSITY,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(geo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = y;
  ring.name = opts.name ?? `${kind}-selection-ring`;
  ring.visible = false;
  return ring;
}

// Phase C.4 — charge ring. A gold radial arc that fills with the charge
// fraction while a worker is in charge mode; the readable replacement for the
// old "tiny invisible" charge bar. Lives here (not in meshes.ts) because the
// chrome-drift guard keeps all RingGeometry construction in this module — and
// a charge ring is per-entity chrome, even though it's a progress indicator
// rather than a selection ring.
const CHARGE_RING_COLOR = 0xffd166; // energy gold — matches the node + charge cue
const CHARGE_RING_INNER = 0.30;
const CHARGE_RING_OUTER = 0.40;
const CHARGE_RING_BUCKETS = 24; // arc resolution

export interface ChargeRing {
  group: THREE.Group;
  // active = worker is in charge mode; fraction = charge / maxCharge.
  set(active: boolean, fraction: number, dt: number): void;
}

export function buildChargeRing(): ChargeRing {
  const group = new THREE.Group();
  group.name = 'charge-ring';
  group.visible = false;
  group.position.y = 0.05; // just above the floor

  // Dim full backing ring so the "remaining" portion still reads as a ring.
  const backGeo = new THREE.RingGeometry(CHARGE_RING_INNER, CHARGE_RING_OUTER, 28);
  const backMat = new THREE.MeshBasicMaterial({
    color: CHARGE_RING_COLOR,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const back = new THREE.Mesh(backGeo, backMat);
  back.rotation.x = -Math.PI / 2;
  back.renderOrder = 5;

  const fillMat = new THREE.MeshBasicMaterial({
    color: CHARGE_RING_COLOR,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  // thetaStart at the top; negative thetaLength grows the arc clockwise. The
  // arc geometry is regenerated only when the charge bucket changes (charge is
  // integer, maxCharge ~10, so ~10 cheap regens per full recharge).
  const makeArcGeo = (bucket: number): THREE.RingGeometry => {
    const frac = bucket / CHARGE_RING_BUCKETS;
    const segs = Math.max(2, bucket);
    return new THREE.RingGeometry(CHARGE_RING_INNER, CHARGE_RING_OUTER, segs, 1, Math.PI / 2, -frac * Math.PI * 2);
  };
  const fill = new THREE.Mesh(makeArcGeo(0), fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.002; // avoid z-fight with the backing ring
  fill.renderOrder = 6;

  group.add(back, fill);

  let lastBucket = -1;
  let pulse = 0;

  return {
    group,
    set(active: boolean, fraction: number, dt: number): void {
      group.visible = active;
      if (!active) {
        lastBucket = -1;
        return;
      }
      const clamped = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
      const bucket = Math.round(clamped * CHARGE_RING_BUCKETS);
      if (bucket !== lastBucket) {
        lastBucket = bucket;
        fill.geometry.dispose();
        fill.geometry = makeArcGeo(bucket);
      }
      pulse += dt;
      // Gentle brightness pulse so the ring reads as actively charging.
      fillMat.opacity = 0.65 + 0.25 * Math.sin(pulse * 4);
    },
  };
}
