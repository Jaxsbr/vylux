// Phase C.6.5 / D.2 — seeded resource-field generator.
//
// Produces the `nodes` array for a normal-match `InitialMatchSpec`. C.6.5 made
// this a scattered field of evenly-spaced singletons with low/med/high values.
// PHASE D.2 evolves it into **seed-grown organic blobs** scattered by a RADIAL
// DENSITY FIELD: a guaranteed Home patch by each base, then small clusters on a
// fine jittered grid whose keep-probability ramps from the board centre (dense)
// to the rim (sparse), minus a clear zone around each HQ. So the field is
// gradually denser toward the contested middle, mixed energy/matter throughout.
// See docs/plan.md "Phase D.2" for the full design + the tweak-X-affects-Y tuning
// table — every default here is tunable, not load-bearing.
//
// MIRROR FAIRNESS (C.6.5, preserved verbatim by D.2): the field is MIRRORED —
// every cluster is grown in the source half (the side of the anti-diagonal
// `x + y < N` nearer faction-0) and each node is paired with its 180° rotation
// `R(x,y) = (N-x, N-y)` about the board centre, which lands the twin near
// faction-1. R swaps the two HQs (which must be point-symmetric about the
// centre), so both halves are identical up to that rotation — neither side gets
// a free-win seed. The cluster is the mirrored unit; "contested" is a pair of
// mirrored blobs flanking the anti-diagonal, never one blob on it.
//
// Determinism: every draw — sizes, positions, tiers, kinds — goes through the
// seeded `Rng` (splitmix64), never `Math.random`, so the same seed always yields
// the same field (the basis for replay / "punch in a seed"). This is a SPEC
// BUILDER, not part of the per-tick sim loop: the bootstrap calls it once to fill
// `spec.nodes`, then the generated array is baked into the spec and serialised
// verbatim into the replay. `playReplay` reconstructs from `replay.spec.nodes`,
// so replays reproduce without re-running the generator.

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
// high node is the prize worth contesting. Tunable in playtest. NOTE (D.2):
// the per-tier `weight` here is the legacy/flat default; clustered fields draw
// tiers via per-archetype weights (ARCHETYPE_WEIGHTS) instead, but reuse these
// same three `energy` values so `classifyTier` / node brightness stay one source
// of truth.
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

// ---------------------------------------------------------------------------
// Phase D.2 — cluster tuning. Each archetype is a set of per-ENERGY_TIERS-index
// draw weights ([low, med, high]); a slot points at one. Lean leans low, Rich
// leans high (and never draws low), so a cluster's size and richness correlate.
// ---------------------------------------------------------------------------

/** Per-tier draw weights, indexed parallel to ENERGY_TIERS ([low, med, high]). */
export type TierWeights = readonly number[];

export const ARCHETYPE_WEIGHTS = {
  /** Common, cheap — mostly low, some med, never high. */
  lean: [6, 2, 0],
  /** Lean→standard transition (the "Second" patch). */
  leanMed: [4, 3, 1],
  /** Mid-game backbone — med-weighted. */
  standard: [2, 4, 1],
  /** Rare contested prize — high-weighted, never low. */
  rich: [0, 2, 4],
} as const;

export interface FieldConfig {
  /**
   * Home patch: a small, guaranteed cluster within HQ vision whose seed node is
   * forced to ENERGY — the bootstrap discovery guarantee (the AI routes only to
   * discovered nodes, and the worker economy is energy-only at tick 0). The 180°
   * mirror covers HQ1.
   */
  readonly homeSizeMin: number;
  readonly homeSizeMax: number;
  /**
   * The map is scattered on a fine jittered grid (one candidate per
   * `cellSize`×`cellSize` cell). Each candidate is KEPT with a probability that
   * RAMPS RADIALLY — `densityCenter` at the board centre falling to `densityEdge`
   * at the rim (`densityNorm` tiles out) — so the field is gradually denser toward
   * the middle and sparser at the edges, never a flat carpet. Smaller cell =
   * denser overall.
   */
  readonly cellSize: number;
  readonly densityCenter: number;
  readonly densityEdge: number;
  readonly densityNorm: number;
  /**
   * Cluster node-count range. Clusters near the centre get `+centerSizeBonus` on
   * top, so the middle is both more-numerous AND slightly bigger — the focal mass.
   */
  readonly clusterSizeMin: number;
  readonly clusterSizeMax: number;
  readonly centerSizeBonus: number;
  /**
   * HQ CLEAR ZONE: no scattered/centre cluster seeds within this Chebyshev
   * radius of either HQ, so the area around each base stays open (only the small
   * bootstrap Home patch sits there). Keeps the home a launch pad, not a mine.
   */
  readonly hqClearRadius: number;
  /**
   * Probability a cluster's *dominant* kind is matter: `matterBase` for ordinary
   * clusters, `matterCenter` for the contested-centre clusters (matter is worth
   * more of the fight in the middle). Home is always forced energy (bootstrap).
   */
  readonly matterBase: number;
  readonly matterCenter: number;
  /** Per-node chance [0,1] to flip to the off-dominant kind (cluster mixing). */
  readonly offKindFlipPct: number;
  /**
   * Accretion: chance [0,1] a growth step jumps a distance-2 tile instead of an
   * adjacent one (lobed/fragmented blobs). Default 0 → contiguous blobs; raise
   * for a more broken-up look (visual tuning — note a detached lobe-node with no
   * neighbour reads as a blocking single per the sim's pathfinding rule).
   */
  readonly gapSkipPct: number;
  /** Inclusive count range of standalone single nodes scattered per source half. */
  readonly singlesMin: number;
  readonly singlesMax: number;
  /**
   * Min Chebyshev gap between nodes of DIFFERENT source clusters. Intra-cluster
   * spacing is implicitly 1 (accretion neighbours pack edge-to-edge). NOTE: a
   * cluster vs its OWN mirror is deliberately NOT spaced — that lets resources
   * pack right up to the anti-diagonal so the contested centre is dense, not a
   * hollow band. (Source + mirror tiles are always disjoint, so they never collide.)
   */
  readonly interSpacing: number;
  /**
   * Inter-cluster gap AT THE BOARD CENTRE (lerps out to `interSpacing` at the
   * rim, by radius). Small here → centre clusters pack tight and merge into the
   * dense contested mass; the rim keeps the roomy `interSpacing` look.
   */
  readonly interSpacingCenter: number;
  /** Min Chebyshev gap a standalone single keeps from EVERY other node (so it
   * never fuses into a cluster and reliably stays solid/blocking). */
  readonly singleIsolation: number;
  /**
   * Min Chebyshev gap every node keeps from an HQ tile. The HQ mesh is a 3×3
   * footprint (Chebyshev ≤ 1), so 2 leaves a clear ring — no node glued to the
   * base. (Mirrors the work-pod HQ keep-out in units-config.)
   */
  readonly hqExclusion: number;
}

export const DEFAULT_FIELD_CONFIG: FieldConfig = {
  homeSizeMin: 2,
  homeSizeMax: 3,
  // Radial-density scatter: a fine jittered grid whose keep-probability ramps from
  // densityCenter (middle) down to densityEdge (rim), so the field is gradually
  // denser toward the contested middle and sparser at the edges — minus clear
  // zones around each HQ. Centre clusters also get a small size bonus. ~150–200 nodes.
  cellSize: 8,
  densityCenter: 1.0,
  densityEdge: 0.32,
  densityNorm: 40,
  clusterSizeMin: 3,
  clusterSizeMax: 5,
  centerSizeBonus: 3,
  hqClearRadius: 12,
  matterBase: 0.4,
  matterCenter: 0.55,
  offKindFlipPct: 0.3,
  gapSkipPct: 0.0,
  singlesMin: 4,
  singlesMax: 8,
  interSpacing: 5,
  interSpacingCenter: 2,
  singleIsolation: 2,
  hqExclusion: 2,
};

export interface EnergyFieldOptions {
  /** Seed for the field RNG. Same seed → identical field. */
  seed: number;
  /** Square grid dimension (tiles per side), e.g. 64. */
  gridSize: number;
  /** HQ tile positions; nodes are barred from each HQ + its 8 neighbours. Must
   * be exactly 2 HQs, point-symmetric about the board centre (mirror generation). */
  hqs: ReadonlyArray<{ x: number; y: number }>;
  /**
   * HQ vision radius in tiles. The generator guarantees the Home cluster's
   * seed node lands within this radius of HQ0 (forced energy), so
   * `initialHqDiscovery` reveals a harvest target on tick 0 — otherwise the AI
   * (which only routes to discovered nodes) never harvests and the match
   * deadlocks. The 180° mirror covers HQ1 for free. Correctness, not fairness.
   */
  hqVisionRadiusTiles: number;
  /** Override the cluster tuning (tests / future UI). Defaults to DEFAULT_FIELD_CONFIG. */
  config?: FieldConfig;
}

export interface GeneratedNode {
  x: number;
  y: number;
  /** Starting reserve (kind-neutral; was `energy` pre-D.1). */
  amount: number;
  /** Phase D.1: which resource this node yields. */
  kind: ResourceKind;
}

// Bounded random-sampling budget before a deterministic scan / give-up. High
// enough that the scan is essentially never reached for sane params.
const MAX_SAMPLE_ATTEMPTS = 600;

const DIRS8: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// A source node, tagged with the cluster that owns it (-1 = standalone single).
// `cluster` is internal bookkeeping for spacing rules; the emitted GeneratedNode
// strips it.
interface SourceNode extends GeneratedNode {
  cluster: number;
}

/**
 * Generate a deterministic, MIRRORED field of resource clusters. See the file
 * header for the mirror invariant and docs/plan.md "Phase D.2" for the design.
 */
export function generateEnergyField(opts: EnergyFieldOptions): GeneratedNode[] {
  const { seed, gridSize, hqs, hqVisionRadiusTiles } = opts;
  const config = opts.config ?? DEFAULT_FIELD_CONFIG;

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
  const lo = 1;
  const hi = gridSize - 2;
  if (hi < lo) {
    throw new Error(`generateEnergyField: gridSize ${gridSize} too small`);
  }
  const cx = Math.floor(N / 2);
  const cy = Math.floor(N / 2);

  const rng = new Rng(seed);

  // Normalised distance to the board centre: 0 at centre, 1 at `densityNorm` out.
  const radial = (x: number, y: number): number =>
    Math.min(1, Math.hypot(x - cx, y - cy) / config.densityNorm);

  // Conservative inner radius for the Home in-vision guarantee — a tile inside
  // the vision radius keeps the node comfortably discoverable despite fixed-point
  // rounding in the sim's distance check.
  const nearR = Math.max(2, hqVisionRadiusTiles - 1);

  // Faction-0's territory is the source triangle (x+y < N); HQ0 and HQ1 sit at
  // the two ends of the anti-diagonal (the shared front). Clusters scatter across
  // the whole triangle and mirror into faction-1's, filling the board.
  const mirror = (x: number, y: number): { x: number; y: number } => ({ x: N - x, y: N - y });
  const inSourceHalf = (x: number, y: number): boolean => x + y < N;
  const inBounds = (x: number, y: number): boolean => x >= lo && x <= hi && y >= lo && y <= hi;
  const farFromHqs = (x: number, y: number): boolean => {
    for (const hq of hqs) {
      if (chebyshev(x, y, hq.x, hq.y) <= config.hqExclusion) return false; // HQ + clear ring
    }
    return true;
  };

  const src: SourceNode[] = [];
  const occupied = new Set<number>();
  const tileKey = (x: number, y: number): number => y * gridSize + x;

  // Weighted tier draw over ENERGY_TIERS indices using a slot's weights.
  const drawTier = (weights: TierWeights): number => {
    let total = 0;
    for (const w of weights) total += w;
    if (total <= 0) return ENERGY_TIERS[0].energy; // degenerate config guard
    let r = rng.nextInt(total);
    for (let i = 0; i < weights.length && i < ENERGY_TIERS.length; i++) {
      r -= weights[i];
      if (r < 0) return ENERGY_TIERS[i].energy;
    }
    return ENERGY_TIERS[ENERGY_TIERS.length - 1].energy;
  };

  // Deterministic Bernoulli at probability `pct` ∈ [0,1] off the seeded stream.
  const chance = (pct: number): boolean => rng.nextInt(1000) < Math.round(pct * 1000);

  // Min Chebyshev gap a candidate keeps from OTHER clusters, RADIAL: tight
  // (`interSpacingCenter`) at the board centre so centre clusters pack into a
  // dense mass, widening to `interSpacing` at the rim so edge patches stay
  // distinct. This is what actually makes the contested middle dense.
  const spacingAt = (x: number, y: number): number =>
    config.interSpacingCenter + (config.interSpacing - config.interSpacingCenter) * radial(x, y);

  // A candidate source tile keeps the radial spacing from every node of a
  // DIFFERENT cluster. Same-cluster nodes are exempt (they pack edge-to-edge).
  const interOk = (x: number, y: number, cluster: number): boolean => {
    const minGap = spacingAt(x, y);
    for (const n of src) {
      if (n.cluster === cluster) continue;
      if (chebyshev(x, y, n.x, n.y) < minGap) return false;
    }
    return true;
  };
  // Valid tile to grow cluster `cluster` onto. NOTE: no source↔mirror spacing —
  // clusters may pack right up to the anti-diagonal so the contested centre is
  // dense. (Source tiles are x+y<N, mirror tiles x+y>N, always disjoint.)
  const growValid = (x: number, y: number, cluster: number): boolean => {
    if (!inBounds(x, y) || !inSourceHalf(x, y) || !farFromHqs(x, y)) return false;
    if (occupied.has(tileKey(x, y))) return false;
    if (!interOk(x, y, cluster)) return false;
    return true;
  };

  const place = (x: number, y: number, cluster: number, kind: ResourceKind, amount: number): void => {
    src.push({ x, y, amount, kind, cluster });
    occupied.add(tileKey(x, y));
  };

  // No scattered/centre cluster seed may sit within hqClearRadius of either HQ,
  // so the area around each base stays open (only the bootstrap Home patch does).
  const farFromHqClear = (x: number, y: number): boolean => {
    for (const hq of hqs) {
      if (chebyshev(x, y, hq.x, hq.y) < config.hqClearRadius) return false;
    }
    return true;
  };

  // Grow one cluster by accretion from a seed: repeatedly add a random
  // 8-connected neighbour until `size` is reached or no valid tile remains
  // (graceful shrink — never throws). The seed node may be forced to energy
  // (Home bootstrap). Tier per node comes from `tierWeights`; kind is the
  // cluster's `dominant` with a per-node off-kind flip.
  const growBlob = (
    seedX: number,
    seedY: number,
    cluster: number,
    size: number,
    dominant: ResourceKind,
    tierWeights: TierWeights,
    forceEnergySeed: boolean,
  ): void => {
    const members: Array<{ x: number; y: number }> = [];
    const addMember = (x: number, y: number, forceEnergy: boolean): void => {
      let kind = dominant;
      if (chance(config.offKindFlipPct)) kind = dominant === 'energy' ? 'matter' : 'energy';
      if (forceEnergy) kind = 'energy';
      place(x, y, cluster, kind, drawTier(tierWeights));
      members.push({ x, y });
    };
    addMember(seedX, seedY, forceEnergySeed);
    while (members.length < size) {
      const step = config.gapSkipPct > 0 && chance(config.gapSkipPct) ? 2 : 1;
      const cand: Array<{ x: number; y: number }> = [];
      for (const m of members) {
        for (const [dx, dy] of DIRS8) {
          const nx = m.x + dx * step;
          const ny = m.y + dy * step;
          if (growValid(nx, ny, cluster)) cand.push({ x: nx, y: ny });
        }
      }
      if (cand.length === 0) break; // graceful shrink
      const pick = cand[rng.nextInt(cand.length)];
      addMember(pick.x, pick.y, false);
    }
  };

  const clusterSize = (): number =>
    config.clusterSizeMin + rng.nextInt(config.clusterSizeMax - config.clusterSizeMin + 1);

  let nextCluster = 0;

  // 1) HOME patch — guaranteed within HQ vision, forced-energy seed (bootstrap).
  //    Picked first so a scattered cluster can't crowd out the in-vision spot.
  {
    const cluster = nextCluster++;
    const homeSize = config.homeSizeMin + rng.nextInt(config.homeSizeMax - config.homeSizeMin + 1);
    const within = (x: number, y: number): boolean => {
      const vx = x - hq0.x;
      const vy = y - hq0.y;
      return vx * vx + vy * vy <= nearR * nearR && growValid(x, y, cluster);
    };
    let seed: { x: number; y: number } | null = null;
    const bxLo = Math.max(lo, hq0.x - nearR);
    const bxHi = Math.min(hi, hq0.x + nearR);
    const byLo = Math.max(lo, hq0.y - nearR);
    const byHi = Math.min(hi, hq0.y + nearR);
    for (let a = 0; a < MAX_SAMPLE_ATTEMPTS && seed === null; a++) {
      const x = bxLo + rng.nextInt(bxHi - bxLo + 1);
      const y = byLo + rng.nextInt(byHi - byLo + 1);
      if (within(x, y)) seed = { x, y };
    }
    if (seed === null) {
      for (let y = byLo; y <= byHi && seed === null; y++) {
        for (let x = bxLo; x <= bxHi && seed === null; x++) {
          if (within(x, y)) seed = { x, y };
        }
      }
    }
    if (seed !== null) {
      growBlob(seed.x, seed.y, cluster, homeSize, 'energy', ARCHETYPE_WEIGHTS.lean, true);
    }
  }

  // 2) RADIAL-DENSITY SCATTER — a fine jittered grid across the whole territory,
  //    but each cell's cluster is KEPT with a probability that ramps from
  //    densityCenter (middle) to densityEdge (rim). Result: gradually denser
  //    toward the contested middle, sparser at the edges — never a flat carpet.
  //    Clusters near the centre also draw bigger + richer + more matter. HQ clear
  //    zones are skipped (only the Home patch lives near a base).
  for (let gy = lo; gy <= hi; gy += config.cellSize) {
    for (let gx = lo; gx <= hi; gx += config.cellSize) {
      const cluster = nextCluster++;
      const cxHi = Math.min(hi, gx + config.cellSize - 1);
      const cyHi = Math.min(hi, gy + config.cellSize - 1);
      let seed: { x: number; y: number } | null = null;
      for (let a = 0; a < 40 && seed === null; a++) {
        const x = gx + rng.nextInt(cxHi - gx + 1);
        const y = gy + rng.nextInt(cyHi - gy + 1);
        if (growValid(x, y, cluster) && farFromHqClear(x, y)) seed = { x, y };
      }
      if (seed === null) continue;
      // 1 at the centre → 0 at the rim (normalised distance to board centre).
      const near = 1 - Math.min(1, Math.hypot(seed.x - cx, seed.y - cy) / config.densityNorm);
      const keepP = config.densityEdge + (config.densityCenter - config.densityEdge) * near;
      if (!chance(keepP)) continue; // thinned out — sparser the further from centre
      const central = near > 0.6;
      const size = clusterSize() + (central ? config.centerSizeBonus : 0);
      const matterPct = config.matterBase + (config.matterCenter - config.matterBase) * near;
      const dominant: ResourceKind = chance(matterPct) ? 'matter' : 'energy';
      const weights = near > 0.6 ? ARCHETYPE_WEIGHTS.rich
        : near > 0.3 ? ARCHETYPE_WEIGHTS.standard
        : ARCHETYPE_WEIGHTS.leanMed;
      growBlob(seed.x, seed.y, cluster, size, dominant, weights, false);
    }
  }

  // 3) Standalone singles — scattered in the gaps, orbiting the blobs. Each must
  //    sit ≥ singleIsolation from every other SOURCE node so it never fuses into
  //    a cluster and reads as a solid single. Kind + value follow centrality.
  const isoOk = (x: number, y: number): boolean => {
    const d = config.singleIsolation;
    for (const n of src) {
      if (chebyshev(x, y, n.x, n.y) < d) return false;
    }
    return true;
  };

  const singleCount = config.singlesMin + rng.nextInt(config.singlesMax - config.singlesMin + 1);
  // Orbit CLUSTER nodes only (not other singles) so singles stay near the blobs
  // instead of chaining off into the empty back-corners.
  const clusterNodes = src.filter((n) => n.cluster >= 0);
  let placedSingles = 0;
  let attempts = 0;
  while (placedSingles < singleCount && attempts < MAX_SAMPLE_ATTEMPTS) {
    attempts++;
    if (clusterNodes.length === 0) break;
    const base = clusterNodes[rng.nextInt(clusterNodes.length)];
    const [dx, dy] = DIRS8[rng.nextInt(DIRS8.length)];
    const dist = config.singleIsolation + 1 + rng.nextInt(4); // 3–6 for the default iso=2
    const x = base.x + dx * dist;
    const y = base.y + dy * dist;
    if (!inBounds(x, y) || !inSourceHalf(x, y) || !farFromHqs(x, y)) continue;
    if (occupied.has(tileKey(x, y))) continue;
    if (!isoOk(x, y)) continue;
    const kind: ResourceKind = chance(config.matterBase) ? 'matter' : 'energy';
    place(x, y, -1, kind, drawTier(ARCHETYPE_WEIGHTS.lean));
    placedSingles++;
  }

  // 5) Bootstrap invariant (hard): there must be ≥1 energy node within HQ vision
  //    of HQ0 (its mirror covers HQ1). The Home seed satisfies this by
  //    construction; a failure here is a real bug, not a tuning miss — throw.
  const hasBootstrap = src.some(
    (n) =>
      n.kind === 'energy' &&
      (n.x - hq0.x) * (n.x - hq0.x) + (n.y - hq0.y) * (n.y - hq0.y) <=
        hqVisionRadiusTiles * hqVisionRadiusTiles,
  );
  if (!hasBootstrap) {
    throw new Error(
      `generateEnergyField: bootstrap invariant violated — no energy node within ` +
        `vision (${hqVisionRadiusTiles}) of HQ (${hq0.x},${hq0.y}) [seed ${seed}]`,
    );
  }

  // 6) Emit each source node + its 180° mirror twin (same amount + kind).
  const out: GeneratedNode[] = [];
  for (const n of src) {
    out.push({ x: n.x, y: n.y, amount: n.amount, kind: n.kind });
    const m = mirror(n.x, n.y);
    out.push({ x: m.x, y: m.y, amount: n.amount, kind: n.kind });
  }
  return out;
}
