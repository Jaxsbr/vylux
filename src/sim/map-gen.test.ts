import { describe, expect, it } from 'vitest';
import {
  classifyTier,
  DEFAULT_FIELD_CONFIG,
  ENERGY_TIERS,
  generateEnergyField,
  type EnergyFieldOptions,
} from './map-gen';

// Mirrors the live PvA arena: 64² grid, two opposite-corner HQs, HQ vision 8.
const BASE: EnergyFieldOptions = {
  seed: 12345,
  gridSize: 64,
  hqs: [
    { x: 8, y: 55 },
    { x: 55, y: 8 },
  ],
  hqVisionRadiusTiles: 8,
};

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

// Expected total-node bounds: Home (2–4) + ~13 scattered clusters (sizes ~2–10
// by centrality) + singles (5–9), each mirrored ×2, with graceful shrink only
// ever lowering the count. Loose bounds — exact count is a per-seed draw.
const MIN_TOTAL = 40; // pessimistic (heavy shrink / crowded seeds)
const MAX_TOTAL = 260; // generous headroom over the typical ~120–180

describe('generateEnergyField (Phase D.2 — clusters)', () => {
  it('is deterministic — same seed → identical field', () => {
    expect(generateEnergyField(BASE)).toEqual(generateEnergyField(BASE));
  });

  it('produces a different field for a different seed', () => {
    const a = generateEnergyField(BASE);
    const b = generateEnergyField({ ...BASE, seed: BASE.seed + 1 });
    expect(a).not.toEqual(b);
  });

  it('places an even number of nodes within the expected range', () => {
    for (let s = 0; s < 30; s++) {
      const nodes = generateEnergyField({ ...BASE, seed: s });
      expect(nodes.length % 2).toBe(0); // mirror pairs
      expect(nodes.length).toBeGreaterThanOrEqual(MIN_TOTAL);
      expect(nodes.length).toBeLessThanOrEqual(MAX_TOTAL);
    }
  });

  it('keeps every node off the outer edge ring', () => {
    for (const n of generateEnergyField(BASE)) {
      expect(n.x).toBeGreaterThanOrEqual(1);
      expect(n.x).toBeLessThanOrEqual(BASE.gridSize - 2);
      expect(n.y).toBeGreaterThanOrEqual(1);
      expect(n.y).toBeLessThanOrEqual(BASE.gridSize - 2);
    }
  });

  it('never places a node on an HQ tile or directly adjacent to one', () => {
    for (const n of generateEnergyField(BASE)) {
      for (const hq of BASE.hqs) {
        expect(chebyshev(n.x, n.y, hq.x, hq.y)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('forms clusters — at least one pair of adjacent nodes exists', () => {
    const nodes = generateEnergyField(BASE);
    let adjacent = false;
    for (let i = 0; i < nodes.length && !adjacent; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (chebyshev(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y) === 1) {
          adjacent = true;
          break;
        }
      }
    }
    expect(adjacent).toBe(true);
  });

  it('guarantees an in-vision ENERGY node for EACH HQ (bootstrap, no AI deadlock)', () => {
    const rSq = BASE.hqVisionRadiusTiles * BASE.hqVisionRadiusTiles;
    for (let s = 0; s < 30; s++) {
      const nodes = generateEnergyField({ ...BASE, seed: s });
      for (const hq of BASE.hqs) {
        const near = nodes.some((n) => {
          const dx = n.x - hq.x;
          const dy = n.y - hq.y;
          return n.kind === 'energy' && dx * dx + dy * dy <= rSq;
        });
        expect(near).toBe(true);
      }
    }
  });

  it('assigns only allowed tier energy values', () => {
    const allowed = new Set(ENERGY_TIERS.map((t) => t.energy));
    for (const n of generateEnergyField(BASE)) {
      expect(allowed.has(n.amount)).toBe(true);
    }
  });

  it('produces a mix of tiers across many seeds', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 40; s++) {
      for (const n of generateEnergyField({ ...BASE, seed: s })) seen.add(n.amount);
    }
    expect(seen.size).toBe(ENERGY_TIERS.length);
  });

  it('stays robust across a sweep of seeds (all constraints hold)', () => {
    for (let s = 0; s < 60; s++) {
      const nodes = generateEnergyField({ ...BASE, seed: s });
      expect(nodes.length).toBeGreaterThanOrEqual(MIN_TOTAL);
      for (const n of nodes) {
        expect(n.x).toBeGreaterThanOrEqual(1);
        expect(n.x).toBeLessThanOrEqual(BASE.gridSize - 2);
        expect(n.y).toBeGreaterThanOrEqual(1);
        expect(n.y).toBeLessThanOrEqual(BASE.gridSize - 2);
        for (const hq of BASE.hqs) {
          expect(chebyshev(n.x, n.y, hq.x, hq.y)).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  // The cluster is the mirrored unit: every node has its 180° twin about the
  // centre, same tier energy AND same kind, so neither side gets a free-win seed.
  it('produces a perfectly mirrored field — every node has its 180° twin', () => {
    const N = BASE.gridSize - 1;
    const nodes = generateEnergyField(BASE);
    for (const n of nodes) {
      const twin = nodes.find(
        (m) => m.x === N - n.x && m.y === N - n.y && m.amount === n.amount && m.kind === n.kind,
      );
      expect(twin).toBeDefined();
    }
  });

  it('mixes energy + matter across seeds, with matter favouring distance from home', () => {
    const hq0 = BASE.hqs[0];
    let sawEnergy = false;
    let sawMatter = false;
    let nearMatter = 0;
    let nearTotal = 0;
    let farMatter = 0;
    let farTotal = 0;
    for (let s = 0; s < 60; s++) {
      for (const n of generateEnergyField({ ...BASE, seed: s })) {
        if (n.kind === 'energy') sawEnergy = true;
        else sawMatter = true;
        // "near" = within the Home band of HQ0; "far" = out toward centre.
        const d = Math.hypot(n.x - hq0.x, n.y - hq0.y);
        if (d <= 10) {
          nearTotal++;
          if (n.kind === 'matter') nearMatter++;
        } else if (d >= 25) {
          farTotal++;
          if (n.kind === 'matter') farMatter++;
        }
      }
    }
    expect(sawEnergy).toBe(true);
    expect(sawMatter).toBe(true);
    // Home-adjacent nodes are (forced/leaning) energy; far nodes lean matter.
    const nearMatterFrac = nearTotal > 0 ? nearMatter / nearTotal : 0;
    const farMatterFrac = farTotal > 0 ? farMatter / farTotal : 0;
    expect(nearMatterFrac).toBeLessThan(farMatterFrac);
  });

  it('throws when the two HQs are not point-symmetric about the centre', () => {
    expect(() =>
      generateEnergyField({ ...BASE, hqs: [{ x: 8, y: 55 }, { x: 50, y: 8 }] }),
    ).toThrow();
  });

  it('throws on anything other than exactly two HQs', () => {
    expect(() => generateEnergyField({ ...BASE, hqs: [{ x: 8, y: 55 }] })).toThrow();
  });

  it('respects a config override (suppressing matter yields an all-energy field)', () => {
    const allEnergy = {
      ...DEFAULT_FIELD_CONFIG,
      matterBase: 0,
      matterCenter: 0,
      offKindFlipPct: 0,
      singlesMin: 0,
      singlesMax: 0,
    };
    for (const n of generateEnergyField({ ...BASE, config: allEnergy })) {
      expect(n.kind).toBe('energy');
    }
  });
});

describe('classifyTier', () => {
  it('maps each tier energy to its own index', () => {
    ENERGY_TIERS.forEach((t, i) => {
      expect(classifyTier(t.energy)).toBe(i);
    });
  });

  it('snaps an off-value to the nearest tier', () => {
    expect(classifyTier(130)).toBe(0);
    expect(classifyTier(1000)).toBe(ENERGY_TIERS.length - 1);
  });
});
