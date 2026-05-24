// Phase C.6.5 — seeded energy-field generator.
//
// Produces the `nodes` array for a normal-match `InitialMatchSpec`: a
// scattered field of energy nodes with randomised positions and randomised
// low/med/high values, replacing the six hand-placed `energy: 200` nodes.
//
// Determinism: every draw goes through the seeded `Rng` (splitmix64) — no
// `Math.random` — so the same seed always yields the same field. This is a
// SPEC BUILDER, not part of the per-tick sim loop: the bootstrap calls it
// once to fill `spec.nodes`, then the generated array is baked into the spec
// and serialised verbatim into the replay. `playReplay` reconstructs from
// `replay.spec.nodes`, so replays reproduce without re-running the generator.
// (Living under src/sim/ keeps it next to `Rng` + the spec type and out of
// the renderer; it draws from its own `Rng` instance, independent of the
// sim's gameplay RNG stream, so it never perturbs the determinism gate.)

import { Rng } from './rng';

export interface EnergyTier {
  readonly name: 'low' | 'med' | 'high';
  /** Starting energy (the node's `remaining` / harvest reserve). */
  readonly energy: number;
  /** Relative draw weight — higher = more common. */
  readonly weight: number;
}

// Tier table. Centred on the legacy flat 200; weighted toward low+med so a
// high node is the prize worth contesting. Tunable in playtest.
export const ENERGY_TIERS: readonly EnergyTier[] = [
  { name: 'low', energy: 120, weight: 4 },
  { name: 'med', energy: 220, weight: 3 },
  { name: 'high', energy: 360, weight: 2 },
] as const;

// Classify an energy value back to its tier index (0 = low … 2 = high) by
// nearest tier energy. The renderer reads this to scale node brightness, so
// the visual tier always tracks whatever ENERGY_TIERS says — one source of
// truth shared between placement (here) and presentation (energy-node.ts).
export function classifyTier(
  energy: number,
  tiers: readonly EnergyTier[] = ENERGY_TIERS,
): number {
  let best = 0;
  let bestDelta = Infinity;
  for (let i = 0; i < tiers.length; i++) {
    const d = Math.abs(tiers[i].energy - energy);
    if (d < bestDelta) {
      bestDelta = d;
      best = i;
    }
  }
  return best;
}

export interface EnergyFieldOptions {
  /** Seed for the field RNG. Same seed → identical field. */
  seed: number;
  /** Square grid dimension (tiles per side), e.g. 64. */
  gridSize: number;
  /** HQ tile positions; nodes are barred from each HQ + its 8 neighbours. */
  hqs: ReadonlyArray<{ x: number; y: number }>;
  /** Total nodes to place (must be ≥ hqs.length). */
  count: number;
  /**
   * HQ vision radius in tiles. The generator guarantees ≥1 node within this
   * radius of EACH HQ so `initialHqDiscovery` reveals a harvest target on
   * tick 0 — otherwise the AI (which only routes to discovered nodes) never
   * harvests and the match deadlocks. Correctness, not fairness.
   */
  hqVisionRadiusTiles: number;
  /** Minimum Chebyshev gap between any two nodes. Default 3. */
  minSpacing?: number;
  /** Override the tier table (tests). Defaults to ENERGY_TIERS. */
  tiers?: readonly EnergyTier[];
}

export interface GeneratedNode {
  x: number;
  y: number;
  energy: number;
}

const DEFAULT_MIN_SPACING = 3;
// Random-sampling budget before falling back to a deterministic scan. High
// enough that the scan is essentially never reached for sane params.
const MAX_SAMPLE_ATTEMPTS = 400;

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Generate a deterministic, constraint-respecting energy field.
 *
 * Constraints enforced on every node:
 *  - inside the grid, off the outer edge ring (tile index 1 … gridSize-2);
 *  - never on an HQ tile, never on a tile directly adjacent (Chebyshev ≤ 1)
 *    to any HQ;
 *  - no two nodes within `minSpacing` (Chebyshev) of each other;
 *  - ≥ 1 node within `hqVisionRadiusTiles` (Euclidean) of each HQ.
 *
 * Placement is fully random (not mirrored) per owner direction — the
 * per-HQ-vision guarantee is the only balance floor.
 */
export function generateEnergyField(opts: EnergyFieldOptions): GeneratedNode[] {
  const {
    seed,
    gridSize,
    hqs,
    count,
    hqVisionRadiusTiles,
    minSpacing = DEFAULT_MIN_SPACING,
    tiers = ENERGY_TIERS,
  } = opts;

  if (count < hqs.length) {
    throw new Error(
      `generateEnergyField: count (${count}) must be ≥ hqs.length (${hqs.length})`,
    );
  }

  const rng = new Rng(seed);
  // Interior tile range, edge ring excluded.
  const lo = 1;
  const hi = gridSize - 2;
  if (hi < lo) {
    throw new Error(`generateEnergyField: gridSize ${gridSize} too small`);
  }

  // Conservative inner radius for the "near each HQ" guarantee. Staying a
  // tile inside the vision radius keeps the node comfortably discoverable
  // regardless of fixed-point rounding in the sim's distance check.
  const nearR = Math.max(2, hqVisionRadiusTiles - 1);

  const placed: GeneratedNode[] = [];

  const farFromHqs = (x: number, y: number): boolean => {
    for (const hq of hqs) {
      if (chebyshev(x, y, hq.x, hq.y) <= 1) return false; // HQ tile + 8 neighbours
    }
    return true;
  };
  const spacedFromPlaced = (x: number, y: number): boolean => {
    for (const n of placed) {
      if (chebyshev(x, y, n.x, n.y) < minSpacing) return false;
    }
    return true;
  };
  const valid = (x: number, y: number): boolean =>
    x >= lo && x <= hi && y >= lo && y <= hi && farFromHqs(x, y) && spacedFromPlaced(x, y);

  // Pick a tile by random sampling within [rxLo,rxHi]×[ryLo,ryHi], falling
  // back to a deterministic scan of that box so generation always succeeds
  // (and stays deterministic) even when the random budget is exhausted.
  // `extra` adds a per-candidate predicate (e.g. the near-HQ radius test).
  const pickTile = (
    rxLo: number,
    rxHi: number,
    ryLo: number,
    ryHi: number,
    extra: (x: number, y: number) => boolean,
  ): { x: number; y: number } | null => {
    const wx = rxHi - rxLo + 1;
    const wy = ryHi - ryLo + 1;
    if (wx <= 0 || wy <= 0) return null;
    for (let a = 0; a < MAX_SAMPLE_ATTEMPTS; a++) {
      const x = rxLo + rng.nextInt(wx);
      const y = ryLo + rng.nextInt(wy);
      if (valid(x, y) && extra(x, y)) return { x, y };
    }
    for (let y = ryLo; y <= ryHi; y++) {
      for (let x = rxLo; x <= rxHi; x++) {
        if (valid(x, y) && extra(x, y)) return { x, y };
      }
    }
    return null;
  };

  const cumulativeWeights: number[] = [];
  let totalWeight = 0;
  for (const t of tiers) {
    totalWeight += t.weight;
    cumulativeWeights.push(totalWeight);
  }
  const drawTierEnergy = (): number => {
    const r = rng.nextInt(totalWeight);
    for (let i = 0; i < cumulativeWeights.length; i++) {
      if (r < cumulativeWeights[i]) return tiers[i].energy;
    }
    return tiers[tiers.length - 1].energy;
  };

  // 1) One guaranteed node within vision of each HQ (so neither side starts
  //    blind). Sampled from a box around the HQ, gated on Euclidean radius.
  for (const hq of hqs) {
    const within = (x: number, y: number): boolean => {
      const dx = x - hq.x;
      const dy = y - hq.y;
      return dx * dx + dy * dy <= nearR * nearR;
    };
    const spot = pickTile(
      Math.max(lo, hq.x - nearR),
      Math.min(hi, hq.x + nearR),
      Math.max(lo, hq.y - nearR),
      Math.min(hi, hq.y + nearR),
      within,
    );
    if (spot === null) {
      throw new Error(
        `generateEnergyField: could not place a node within vision of HQ (${hq.x},${hq.y})`,
      );
    }
    placed.push({ x: spot.x, y: spot.y, energy: drawTierEnergy() });
  }

  // 2) Remaining nodes scattered anywhere valid across the whole interior.
  while (placed.length < count) {
    const spot = pickTile(lo, hi, lo, hi, () => true);
    if (spot === null) {
      throw new Error(
        `generateEnergyField: ran out of valid tiles at ${placed.length}/${count} ` +
          `(grid ${gridSize}, minSpacing ${minSpacing})`,
      );
    }
    placed.push({ x: spot.x, y: spot.y, energy: drawTierEnergy() });
  }

  return placed;
}
