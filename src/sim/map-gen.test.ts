import { describe, expect, it } from 'vitest';
import {
  classifyTier,
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
  count: 16,
  hqVisionRadiusTiles: 8,
};

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

describe('generateEnergyField', () => {
  it('is deterministic — same seed → identical field', () => {
    const a = generateEnergyField(BASE);
    const b = generateEnergyField(BASE);
    expect(a).toEqual(b);
  });

  it('produces a different field for a different seed', () => {
    const a = generateEnergyField(BASE);
    const b = generateEnergyField({ ...BASE, seed: BASE.seed + 1 });
    // Layouts should differ somewhere in the first few nodes.
    expect(a).not.toEqual(b);
  });

  it('places exactly `count` nodes', () => {
    expect(generateEnergyField(BASE)).toHaveLength(BASE.count);
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
        expect(chebyshev(n.x, n.y, hq.x, hq.y)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('respects the minimum inter-node spacing (no duplicates, no clumping)', () => {
    const minSpacing = 3;
    const nodes = generateEnergyField({ ...BASE, minSpacing });
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        expect(chebyshev(nodes[i].x, nodes[i].y, nodes[j].x, nodes[j].y))
          .toBeGreaterThanOrEqual(minSpacing);
      }
    }
  });

  it('guarantees ≥1 node within HQ vision of EACH HQ (no AI deadlock)', () => {
    const nodes = generateEnergyField(BASE);
    const rSq = BASE.hqVisionRadiusTiles * BASE.hqVisionRadiusTiles;
    for (const hq of BASE.hqs) {
      const near = nodes.some((n) => {
        const dx = n.x - hq.x;
        const dy = n.y - hq.y;
        return dx * dx + dy * dy <= rSq;
      });
      expect(near).toBe(true);
    }
  });

  it('assigns only allowed tier energy values', () => {
    const allowed = new Set(ENERGY_TIERS.map((t) => t.energy));
    for (const n of generateEnergyField(BASE)) {
      expect(allowed.has(n.energy)).toBe(true);
    }
  });

  it('produces a mix of tiers across many seeds (values are randomised)', () => {
    const seen = new Set<number>();
    for (let s = 0; s < 40; s++) {
      for (const n of generateEnergyField({ ...BASE, seed: s })) seen.add(n.energy);
    }
    // Over 40 seeds × 16 nodes we expect all three tiers to appear.
    expect(seen.size).toBe(ENERGY_TIERS.length);
  });

  it('stays robust across a sweep of seeds (all constraints hold)', () => {
    for (let s = 0; s < 50; s++) {
      const nodes = generateEnergyField({ ...BASE, seed: s });
      expect(nodes).toHaveLength(BASE.count);
      for (const n of nodes) {
        expect(n.x).toBeGreaterThanOrEqual(1);
        expect(n.x).toBeLessThanOrEqual(BASE.gridSize - 2);
        expect(n.y).toBeGreaterThanOrEqual(1);
        expect(n.y).toBeLessThanOrEqual(BASE.gridSize - 2);
        for (const hq of BASE.hqs) {
          expect(chebyshev(n.x, n.y, hq.x, hq.y)).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('throws when count is below the HQ count', () => {
    expect(() => generateEnergyField({ ...BASE, count: 1 })).toThrow();
  });
});

describe('classifyTier', () => {
  it('maps each tier energy to its own index', () => {
    ENERGY_TIERS.forEach((t, i) => {
      expect(classifyTier(t.energy)).toBe(i);
    });
  });

  it('snaps an off-value to the nearest tier', () => {
    // 130 is closest to low (120); 1000 closest to high (360).
    expect(classifyTier(130)).toBe(0);
    expect(classifyTier(1000)).toBe(ENERGY_TIERS.length - 1);
  });
});
