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
