// Phase C.6.5 — seeded energy-field generator.
//
// Produces the `nodes` array for a normal-match `InitialMatchSpec`: a
// scattered field of energy nodes with randomised positions and randomised
// low/med/high values, replacing the six hand-placed `energy: 200` nodes.
//
// PRE-PHASE-D FAIRNESS (2026-05-28): the field is now MIRRORED — nodes are
// drawn in the source half (the side of the anti-diagonal nearer faction-0)
// and each is paired with its 180° rotation about the board centre, which
// lands the twin near faction-1. Both halves end up identical up to the
// rotation that swaps the two HQs, so neither side gets a free-win seed.
// This is the prototype-fairness stopgap that pairs with the new timed
// match + score (see plan.md "Phase D — The Living Economy"): a scoreboard
// is only an honest measure when the starts are fair. Phase D.2 may replace
// this with varied-but-balanced clusters (different positions, equal
// value-budget per side); for now exact mirror is the cheapest trustworthy
// floor.
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
import type { ResourceKind } from './types';

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
  /**
   * Phase D.1: "1 in N" odds that a (non-guaranteed) source/mirror pair is
   * MATTER rather than energy. Default 3 → ~1/3 of scattered pairs are matter.
   * The guaranteed near-HQ pair is always energy (bootstrap), so it ignores
   * this. Set high to suppress matter (tests).
   */
  matterOneIn?: number;
}

export interface GeneratedNode {
  x: number;
  y: number;
  /** Starting reserve (kind-neutral; was `energy` pre-D.1). */
  amount: number;
  /** Phase D.1: which resource this node yields. */
  kind: ResourceKind;
}

const DEFAULT_MIN_SPACING = 3;
// Phase D.1: ~1/3 of scattered pairs are matter (1 in 3). Tunable per call.
const DEFAULT_MATTER_ONE_IN = 3;
// Random-sampling budget before falling back to a deterministic scan. High
// enough that the scan is essentially never reached for sane params.
const MAX_SAMPLE_ATTEMPTS = 400;

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/**
 * Generate a deterministic, MIRRORED, constraint-respecting energy field.
 *
 * Constraints enforced on every node:
 *  - inside the grid, off the outer edge ring (tile index 1 … gridSize-2);
 *  - never on an HQ tile, never on a tile directly adjacent (Chebyshev ≤ 1)
 *    to any HQ;
 *  - no two nodes within `minSpacing` (Chebyshev) of each other;
 *  - ≥ 1 node within `hqVisionRadiusTiles` (Euclidean) of each HQ.
 *
 * Mirror generation: nodes are drawn in the source half (x + y < gridSize-1,
 * the side of the anti-diagonal nearer faction-0) and each is paired with
 * its 180° rotation about the board centre — `R(x,y) = (N-x, N-y)` where
 * `N = gridSize - 1`. R is an isometry that swaps the two HQs (which must
 * be point-symmetric about the centre — enforced below), so a source node
 * that's interior / off-edge / far-from-HQs has a twin that automatically
 * satisfies the same. Only spacing has to be checked explicitly for both.
 * `count` must be even; nodes are placed in source/mirror pairs.
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
    matterOneIn = DEFAULT_MATTER_ONE_IN,
  } = opts;

  if (count < hqs.length) {
    throw new Error(
      `generateEnergyField: count (${count}) must be ≥ hqs.length (${hqs.length})`,
    );
  }
  // Mirror generation needs an even count — each source-half node ships with
  // its 180°-rotated twin, so the field is always placed as pairs.
  if (count % 2 !== 0) {
    throw new Error(
      `generateEnergyField: count (${count}) must be even (mirror generation places nodes in pairs)`,
    );
  }
  // The mirror swap requires exactly 2 HQs, point-symmetric about the board
  // centre. The live arena (HQs at (8,55) and (55,8) on a 64-grid) satisfies
  // this; the test BASE spec does too. Fail loudly if a caller drifts off.
  if (hqs.length !== 2) {
    throw new Error(
      `generateEnergyField: mirror generation expects exactly 2 HQs (got ${hqs.length})`,
    );
  }
  const N = gridSize - 1;
  const [hq0, hq1] = hqs;
  if (hq0.x + hq1.x !== N || hq0.y + hq1.y !== N) {
    throw new Error(
      `generateEnergyField: HQs must be point-symmetric about the board centre ` +
        `for mirror generation (hq0=(${hq0.x},${hq0.y}), hq1=(${hq1.x},${hq1.y}), grid ${gridSize})`,
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

  // R: 180° point reflection about the board centre. Source-half tiles
  // (x+y < N) map to f1-half tiles (x+y > N); the anti-diagonal x+y == N
  // is the dividing line and gets skipped (`inSourceHalf` is strict).
  const mirror = (x: number, y: number): { x: number; y: number } => ({ x: N - x, y: N - y });

  const placed: GeneratedNode[] = [];

  const inSourceHalf = (x: number, y: number): boolean => x + y < N;
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
  // A candidate source tile is "pair-valid" only when the SOURCE passes every
  // constraint AND its mirror is spaced from every already-placed node AND
  // source/mirror are themselves spaced (matters for source tiles close to
  // the diagonal, where the pair can collapse together). R is an isometry
  // and the HQs are point-symmetric, so the mirror's interior + far-from-HQs
  // checks fall out of the source's automatically — only spacing needs to
  // read the mirror coordinate.
  const pairValid = (x: number, y: number): boolean => {
    if (!inSourceHalf(x, y)) return false;
    if (x < lo || x > hi || y < lo || y > hi) return false;
    if (!farFromHqs(x, y)) return false;
    if (!spacedFromPlaced(x, y)) return false;
    const m = mirror(x, y);
    if (!spacedFromPlaced(m.x, m.y)) return false;
    if (chebyshev(x, y, m.x, m.y) < minSpacing) return false;
    return true;
  };

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
      if (pairValid(x, y) && extra(x, y)) return { x, y };
    }
    for (let y = ryLo; y <= ryHi; y++) {
      for (let x = rxLo; x <= rxHi; x++) {
        if (pairValid(x, y) && extra(x, y)) return { x, y };
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

  // Phase D.1: draw a node kind. ~1-in-`matterOneIn` pairs are matter; the
  // rest energy. Off the same seeded stream so the field stays deterministic.
  const drawKind = (): ResourceKind => (rng.nextInt(matterOneIn) === 0 ? 'matter' : 'energy');

  // Push a source/mirror pair, both carrying the SAME drawn tier value AND
  // the SAME kind — perfect mirror in position, reserve, and resource so
  // matter access is symmetric. One tier draw per pair keeps the RNG stream
  // short + deterministic; the kind is decided by the caller (the guaranteed
  // near-HQ pair forces energy, scattered pairs draw it).
  const pushPair = (x: number, y: number, kind: ResourceKind): void => {
    const amount = drawTierEnergy();
    const m = mirror(x, y);
    placed.push({ x, y, amount, kind });
    placed.push({ x: m.x, y: m.y, amount, kind });
  };

  // 1) One guaranteed node within HQ_F0's vision (in the source half). Its
  //    mirror automatically lands within HQ_F1's vision — R is an isometry
  //    that swaps the HQs — so neither side starts blind. (No separate near
  //    pick for HQ_F1; the rotation does that for us.)
  {
    const within = (x: number, y: number): boolean => {
      const dx = x - hq0.x;
      const dy = y - hq0.y;
      return dx * dx + dy * dy <= nearR * nearR;
    };
    const spot = pickTile(
      Math.max(lo, hq0.x - nearR),
      Math.min(hi, hq0.x + nearR),
      Math.max(lo, hq0.y - nearR),
      Math.min(hi, hq0.y + nearR),
      within,
    );
    if (spot === null) {
      throw new Error(
        `generateEnergyField: could not place a source-half node within vision of HQ (${hq0.x},${hq0.y})`,
      );
    }
    // Guaranteed near-HQ pair stays ENERGY so the bootstrap worker economy
    // (worker = energy-only) always has a reachable energy node on tick 0.
    // Matter is something you scout out and expand toward.
    pushPair(spot.x, spot.y, 'energy');
  }

  // 2) Remaining pairs scattered anywhere pair-valid in the source half.
  //    pushPair adds 2 entries per iteration; loop until `count` nodes total
  //    are placed (count is required even).
  while (placed.length < count) {
    const spot = pickTile(lo, hi, lo, hi, () => true);
    if (spot === null) {
      throw new Error(
        `generateEnergyField: ran out of valid source-half tiles at ${placed.length}/${count} ` +
          `(grid ${gridSize}, minSpacing ${minSpacing})`,
      );
    }
    pushPair(spot.x, spot.y, drawKind());
  }

  return placed;
}
