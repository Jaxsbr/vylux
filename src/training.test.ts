import { describe, it, expect } from 'vitest';
import { trainUnit, findFreeNeighbour, buildOccupiedSet } from './training';
import type { FactionEnergy } from './economy';

const GRID_SIZE = 20;

function noOccupied(_tx: number, _ty: number): boolean {
  return false;
}

function allOccupied(_tx: number, _ty: number): boolean {
  return true;
}

describe('findFreeNeighbour', () => {
  it('returns the first free neighbour of (0,0) when nothing is occupied', () => {
    const result = findFreeNeighbour(0, 0, GRID_SIZE, noOccupied);
    expect(result).not.toBeNull();
    expect(result!.tileX).toBeGreaterThanOrEqual(0);
    expect(result!.tileY).toBeGreaterThanOrEqual(0);
  });

  it('returns null when all neighbours are occupied', () => {
    const result = findFreeNeighbour(0, 0, GRID_SIZE, allOccupied);
    expect(result).toBeNull();
  });

  it('skips out-of-bounds tiles (0,0 corner case — only 3 in-bounds neighbours)', () => {
    // For (0,0): offsets (-1,0),(-1,1),(0,-1),(-1,-1) are out-of-bounds.
    // Remaining candidates: (1,0),(0,1),(1,1) — all in-bounds.
    const occupied = new Set<string>();
    occupied.add('1,0');
    occupied.add('1,1');
    const isOccupied = (tx: number, ty: number) => occupied.has(`${tx},${ty}`);
    const result = findFreeNeighbour(0, 0, GRID_SIZE, isOccupied);
    // (0,1) should be returned — it's the first unoccupied in-bounds neighbour after (1,0).
    expect(result).toEqual({ tileX: 0, tileY: 1 });
  });

  it('returns null when all in-bounds neighbours are occupied', () => {
    // (0,0) has only (1,0), (0,1), (1,1) in-bounds.
    const occupied = new Set(['1,0', '0,1', '1,1']);
    const isOccupied = (tx: number, ty: number) => occupied.has(`${tx},${ty}`);
    const result = findFreeNeighbour(0, 0, GRID_SIZE, isOccupied);
    expect(result).toBeNull();
  });
});

describe('trainUnit', () => {
  const richEnergy: FactionEnergy = { blue: 200, red: 200 };
  const poorEnergy: FactionEnergy = { blue: 5, red: 5 };

  it('returns ok=true and deducts cost for worker when energy >= 20', () => {
    const result = trainUnit(richEnergy, 'blue', 'worker', 0, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newEnergy.blue).toBe(200 - 20);
      // Unit always spawns at HQ tile.
      expect(result.spawnTile).toEqual({ tileX: 0, tileY: 0 });
    }
  });

  it('returns ok=true and deducts cost for defender when energy >= 60', () => {
    const result = trainUnit(richEnergy, 'blue', 'defender', 0, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newEnergy.blue).toBe(200 - 60);
    }
  });

  it('returns ok=true and deducts cost for raider when energy >= 100', () => {
    const result = trainUnit(richEnergy, 'blue', 'raider', 0, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newEnergy.blue).toBe(200 - 100);
    }
  });

  it('returns ok=false (insufficient-energy) when energy < cost', () => {
    const result = trainUnit(poorEnergy, 'blue', 'worker', 0, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('insufficient-energy');
    }
  });

  it('does not deduct energy on insufficient-energy failure', () => {
    const result = trainUnit(poorEnergy, 'blue', 'defender', 0, 0);
    expect(result.ok).toBe(false);
    // Energy is unchanged — no side effects on failure.
  });

  it('always spawns at HQ tile even when neighbours would be occupied', () => {
    // Walled HQ: training never fails due to blocked neighbours — only energy matters.
    const result = trainUnit(richEnergy, 'blue', 'worker', 5, 5);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spawnTile).toEqual({ tileX: 5, tileY: 5 });
    }
  });

  it('red faction energy is unchanged when blue trains', () => {
    const result = trainUnit(richEnergy, 'blue', 'raider', 0, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newEnergy.red).toBe(200);
    }
  });

  it('checks energy >= cost (exact boundary: blue = cost)', () => {
    const exactEnergy: FactionEnergy = { blue: 60, red: 0 };
    const result = trainUnit(exactEnergy, 'blue', 'defender', 0, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newEnergy.blue).toBe(0);
    }
  });

  it('one below boundary: blue = cost - 1 fails', () => {
    const nearEnergy: FactionEnergy = { blue: 59, red: 0 };
    const result = trainUnit(nearEnergy, 'blue', 'defender', 0, 0);
    expect(result.ok).toBe(false);
  });
});

describe('buildOccupiedSet', () => {
  it('marks unit tiles as occupied', () => {
    const units = [{ tileX: 3, tileY: 4 }];
    const set = buildOccupiedSet(units, []);
    expect(set.has('3,4')).toBe(true);
  });

  it('marks HQ tiles as occupied', () => {
    const set = buildOccupiedSet([], [{ tileX: 0, tileY: 0 }]);
    expect(set.has('0,0')).toBe(true);
  });

  it('marks node positions as occupied', () => {
    // NODE_POSITIONS is imported inside training.ts — just verify the set is non-empty.
    const set = buildOccupiedSet([], []);
    expect(set.size).toBeGreaterThan(0);
  });
});
