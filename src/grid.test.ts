import { describe, it, expect } from 'vitest';
import { GRID_CONSTANTS, TILE_COUNT, tileToWorld } from './grid';

describe('GRID_CONSTANTS', () => {
  it('is a 20x20 grid of unit tiles (400 total)', () => {
    expect(GRID_CONSTANTS.gridSize).toBe(20);
    expect(GRID_CONSTANTS.tileSize).toBe(1);
    expect(GRID_CONSTANTS.worldExtent).toBe(GRID_CONSTANTS.gridSize * GRID_CONSTANTS.tileSize);
    expect(TILE_COUNT).toBe(400);
  });
});

describe('tileToWorld — determinism', () => {
  it('(0, 0) centers the near-corner tile at world (-9.5, 0, -9.5)', () => {
    const p = tileToWorld(0, 0);
    expect(p.x).toBeCloseTo(-9.5);
    expect(p.y).toBe(0);
    expect(p.z).toBeCloseTo(-9.5);
  });

  it('(19, 19) centers the far-corner tile at world (9.5, 0, 9.5)', () => {
    const p = tileToWorld(19, 19);
    expect(p.x).toBeCloseTo(9.5);
    expect(p.y).toBe(0);
    expect(p.z).toBeCloseTo(9.5);
  });

  it('(10, 10) returns a mid-grid position at world (0.5, 0, 0.5)', () => {
    const p = tileToWorld(10, 10);
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBe(0);
    expect(p.z).toBeCloseTo(0.5);
  });

  it('is pure — repeated calls produce identical results', () => {
    const a = tileToWorld(7, 3);
    const b = tileToWorld(7, 3);
    expect(a).toEqual(b);
  });
});

describe('tileToWorld — uniqueness', () => {
  it('all 400 in-bounds tile positions are unique', () => {
    const seen = new Set<string>();
    for (let x = 0; x < GRID_CONSTANTS.gridSize; x++) {
      for (let y = 0; y < GRID_CONSTANTS.gridSize; y++) {
        const p = tileToWorld(x, y);
        seen.add(`${p.x.toFixed(6)},${p.z.toFixed(6)}`);
      }
    }
    expect(seen.size).toBe(TILE_COUNT);
  });
});

describe('tileToWorld — out-of-bounds', () => {
  it.each<[number, number]>([
    [-1, 0],
    [0, 20],
    [20, 20],
    [NaN, 0],
  ])('throws a descriptive error on (%s, %s)', (x, y) => {
    expect(() => tileToWorld(x, y)).toThrow(/tile coordinates/);
  });
});
