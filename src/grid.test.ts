import { describe, it, expect } from 'vitest';
import { GRID_CONSTANTS, TILE_COUNT, tileToWorld, buildGrid } from './grid';

// Tests are parametric on GRID_CONSTANTS.gridSize so changing the
// constant in 3.4+ doesn't ripple a dozen hardcoded numbers through
// this file. The contract being verified is the math + uniqueness
// shape, not a particular grid size.
const N = GRID_CONSTANTS.gridSize;
const NEAR = -GRID_CONSTANTS.worldExtent / 2 + GRID_CONSTANTS.tileSize / 2;
const FAR = GRID_CONSTANTS.worldExtent / 2 - GRID_CONSTANTS.tileSize / 2;
const MID_TILE = N / 2;
const MID_WORLD = NEAR + MID_TILE * GRID_CONSTANTS.tileSize;

describe('GRID_CONSTANTS', () => {
  it('is an N×N grid of unit tiles (worldExtent derived from gridSize)', () => {
    expect(GRID_CONSTANTS.gridSize).toBeGreaterThan(0);
    expect(GRID_CONSTANTS.tileSize).toBe(1);
    expect(GRID_CONSTANTS.worldExtent).toBe(GRID_CONSTANTS.gridSize * GRID_CONSTANTS.tileSize);
    expect(TILE_COUNT).toBe(N * N);
  });
});

describe('tileToWorld — determinism', () => {
  it('(0, 0) centers the near-corner tile at the worldExtent-derived offset', () => {
    const p = tileToWorld(0, 0);
    expect(p.x).toBeCloseTo(NEAR);
    expect(p.y).toBe(0);
    expect(p.z).toBeCloseTo(NEAR);
  });

  it('(N-1, N-1) centers the far-corner tile at +(worldExtent/2 - tileSize/2)', () => {
    const p = tileToWorld(N - 1, N - 1);
    expect(p.x).toBeCloseTo(FAR);
    expect(p.y).toBe(0);
    expect(p.z).toBeCloseTo(FAR);
  });

  it('(N/2, N/2) returns a mid-grid position', () => {
    const p = tileToWorld(MID_TILE, MID_TILE);
    expect(p.x).toBeCloseTo(MID_WORLD);
    expect(p.y).toBe(0);
    expect(p.z).toBeCloseTo(MID_WORLD);
  });

  it('is pure — repeated calls produce identical results', () => {
    const a = tileToWorld(7, 3);
    const b = tileToWorld(7, 3);
    expect(a).toEqual(b);
  });
});

describe('tileToWorld — uniqueness', () => {
  it('all in-bounds tile positions are unique', () => {
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
    [0, N],
    [N, N],
    [NaN, 0],
  ])('throws a descriptive error on (%s, %s)', (x, y) => {
    expect(() => tileToWorld(x, y)).toThrow(/tile coordinates/);
  });
});

describe('buildGrid', () => {
  it('returns TILE_COUNT tile meshes with unique (tileX, tileY) userData', () => {
    const grid = buildGrid();
    expect(grid.tileMeshes).toHaveLength(TILE_COUNT);
    const seen = new Set<string>();
    for (const mesh of grid.tileMeshes) {
      const ud = mesh.userData as { tileX: number; tileY: number };
      expect(Number.isInteger(ud.tileX)).toBe(true);
      expect(Number.isInteger(ud.tileY)).toBe(true);
      seen.add(`${ud.tileX},${ud.tileY}`);
    }
    expect(seen.size).toBe(TILE_COUNT);
  });

  it('every tile material color is #0a0a0a and each tile has its own material instance', () => {
    const grid = buildGrid();
    expect(grid.tileColors).toHaveLength(TILE_COUNT);
    for (const hex of grid.tileColors) {
      expect(hex).toBe('#0a0a0a');
    }
    const materialIds = new Set(grid.tileMeshes.map((m) => (m.material as { uuid: string }).uuid));
    expect(materialIds.size).toBe(TILE_COUNT);
  });

  it('major + minor grid line materials are both emissive grey, minor is dimmer than major', () => {
    const grid = buildGrid();
    expect(grid.majorGridLineMaterial.emissive.getHexString()).toBe('555555');
    expect(grid.minorGridLineMaterial.emissive.getHexString()).toBe('555555');
    // Phase 3.9.4 bumped major intensity from ~0.4 to 1.2 so the grid
    // reads as neon under the fog overlay. The lower bound flags
    // accidental zeroing; the upper bound leaves tuning room. Minor
    // lines must be strictly dimmer than major so the hierarchy reads.
    expect(grid.majorGridLineMaterial.emissiveIntensity).toBeGreaterThanOrEqual(0.1);
    expect(grid.majorGridLineMaterial.emissiveIntensity).toBeLessThanOrEqual(2.0);
    expect(grid.minorGridLineMaterial.emissiveIntensity).toBeGreaterThan(0);
    expect(grid.minorGridLineMaterial.emissiveIntensity).toBeLessThan(grid.majorGridLineMaterial.emissiveIntensity);
  });

  it('extended grid materials are transparent and dimmer than the play grid', () => {
    const grid = buildGrid();
    // transparent + depthWrite:false are load-bearing — the radial
    // fade shader patch multiplies fragment alpha, so non-transparent
    // materials would render the faded region as opaque black.
    expect(grid.extendedMajorGridLineMaterial.transparent).toBe(true);
    expect(grid.extendedMajorGridLineMaterial.depthWrite).toBe(false);
    expect(grid.extendedMinorGridLineMaterial.transparent).toBe(true);
    expect(grid.extendedMinorGridLineMaterial.depthWrite).toBe(false);
    // The extended grid is meant to recede into the background; it
    // must not match or exceed the play grid's emissive intensity or
    // the foreground/background separation collapses.
    expect(grid.extendedMajorGridLineMaterial.emissiveIntensity).toBeLessThan(
      grid.majorGridLineMaterial.emissiveIntensity,
    );
    expect(grid.extendedMinorGridLineMaterial.emissiveIntensity).toBeLessThan(
      grid.minorGridLineMaterial.emissiveIntensity,
    );
    // The radial fade is wired via onBeforeCompile; assert the
    // callback is installed so a refactor that drops it gets caught.
    expect(typeof grid.extendedMajorGridLineMaterial.onBeforeCompile).toBe('function');
    expect(typeof grid.extendedMinorGridLineMaterial.onBeforeCompile).toBe('function');
  });
});
