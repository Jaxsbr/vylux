import { describe, it, expect } from 'vitest';
import { computeNodeHolder, tickNodePoints } from './node-points';
import { createPointsLedger } from './points';
import type { EnergyNodeBundle } from './energy-node';

function makeNode(tileX: number, tileY: number): EnergyNodeBundle {
  return {
    group: {} as never,
    setFactionHold: () => undefined,
    tileX,
    tileY,
    pointAccumulator: 0,
    lastHolder: null,
  };
}

describe('computeNodeHolder', () => {
  it('returns blue when only blue worker is on the tile', () => {
    const node = { tileX: 5, tileY: 5 };
    const units = [{ faction: 'blue' as const, tileX: 5, tileY: 5 }];
    expect(computeNodeHolder(node, units)).toBe('blue');
  });

  it('returns red when only red worker is on the tile', () => {
    const node = { tileX: 5, tileY: 5 };
    const units = [{ faction: 'red' as const, tileX: 5, tileY: 5 }];
    expect(computeNodeHolder(node, units)).toBe('red');
  });

  it('returns null when contested (blue + red on tile)', () => {
    const node = { tileX: 5, tileY: 5 };
    const units = [
      { faction: 'blue' as const, tileX: 5, tileY: 5 },
      { faction: 'red' as const, tileX: 5, tileY: 5 },
    ];
    expect(computeNodeHolder(node, units)).toBeNull();
  });

  it('returns null when no units on the tile', () => {
    const node = { tileX: 5, tileY: 5 };
    const units = [{ faction: 'blue' as const, tileX: 3, tileY: 3 }];
    expect(computeNodeHolder(node, units)).toBeNull();
  });

  it('ignores units on adjacent tiles', () => {
    const node = { tileX: 5, tileY: 5 };
    const units = [{ faction: 'blue' as const, tileX: 5, tileY: 6 }];
    expect(computeNodeHolder(node, units)).toBeNull();
  });
});

describe('tickNodePoints', () => {
  it('uncontested blue worker on node for 1.0s → blue gains exactly 1 point', () => {
    const ledger = createPointsLedger();
    const node = makeNode(5, 5);
    const units = [{ faction: 'blue' as const, tileX: 5, tileY: 5 }];

    tickNodePoints({ nodes: [node], units, pointsLedger: ledger, dt: 1.0 });

    expect(ledger.get().blue).toBe(1);
    expect(ledger.get().red).toBe(0);
  });

  it('contested node → neither faction accrues', () => {
    const ledger = createPointsLedger();
    const node = makeNode(5, 5);
    const units = [
      { faction: 'blue' as const, tileX: 5, tileY: 5 },
      { faction: 'red' as const, tileX: 5, tileY: 5 },
    ];

    tickNodePoints({ nodes: [node], units, pointsLedger: ledger, dt: 5.0 });

    expect(ledger.get().blue).toBe(0);
    expect(ledger.get().red).toBe(0);
  });

  it('empty node → no faction accrues', () => {
    const ledger = createPointsLedger();
    const node = makeNode(5, 5);

    tickNodePoints({ nodes: [node], units: [], pointsLedger: ledger, dt: 10.0 });

    expect(ledger.get().blue).toBe(0);
    expect(ledger.get().red).toBe(0);
  });

  it('holder flip zeroes the accumulator — blue accumulator does not transfer to red', () => {
    const ledger = createPointsLedger();
    const node = makeNode(5, 5);

    // Tick 0.6s with blue on node — accumulator reaches 0.6 (no whole point yet).
    const blueUnits = [{ faction: 'blue' as const, tileX: 5, tileY: 5 }];
    tickNodePoints({ nodes: [node], units: blueUnits, pointsLedger: ledger, dt: 0.6 });
    expect(node.pointAccumulator).toBeCloseTo(0.6);
    expect(ledger.get().blue).toBe(0);

    // Now red takes the node — accumulator must reset to 0.
    const redUnits = [{ faction: 'red' as const, tileX: 5, tileY: 5 }];
    tickNodePoints({ nodes: [node], units: redUnits, pointsLedger: ledger, dt: 0.9 });

    // Red held for 0.9s from a zeroed accumulator — no whole point yet.
    expect(node.pointAccumulator).toBeCloseTo(0.9);
    expect(ledger.get().blue).toBe(0);
    expect(ledger.get().red).toBe(0);
  });

  it('multiple held nodes accrue independently', () => {
    const ledger = createPointsLedger();
    const nodeA = makeNode(5, 5);
    const nodeB = makeNode(14, 14);

    const units = [
      { faction: 'blue' as const, tileX: 5, tileY: 5 },
      { faction: 'red' as const, tileX: 14, tileY: 14 },
    ];

    // 2.5 seconds — each node accrues independently.
    tickNodePoints({ nodes: [nodeA, nodeB], units, pointsLedger: ledger, dt: 2.5 });

    expect(ledger.get().blue).toBe(2);
    expect(ledger.get().red).toBe(2);
    // Remainders should be ~0.5 each.
    expect(nodeA.pointAccumulator).toBeCloseTo(0.5);
    expect(nodeB.pointAccumulator).toBeCloseTo(0.5);
  });

  it('accumulates fractional ticks correctly (sub-frame ticks)', () => {
    const ledger = createPointsLedger();
    const node = makeNode(5, 5);
    const units = [{ faction: 'blue' as const, tileX: 5, tileY: 5 }];

    // 62 ticks of ~0.016s each (≈ 0.992s total — just under 1 whole point).
    for (let i = 0; i < 62; i++) {
      tickNodePoints({ nodes: [node], units, pointsLedger: ledger, dt: 0.016 });
    }
    // 62 × 0.016 = 0.992 → no whole point yet.
    expect(ledger.get().blue).toBe(0);

    // One more tick to cross 1.0.
    tickNodePoints({ nodes: [node], units, pointsLedger: ledger, dt: 0.016 });
    // 63 × 0.016 = 1.008 → 1 whole point emitted.
    expect(ledger.get().blue).toBe(1);
  });
});
