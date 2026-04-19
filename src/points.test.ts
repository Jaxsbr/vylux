import { describe, it, expect } from 'vitest';
import { setPointValues, createPointsLedger } from './points';

describe('setPointValues', () => {
  it('overrides both factions', () => {
    const next = setPointValues({ blue: 0, red: 0 }, { blue: 120, red: 60 });
    expect(next.blue).toBe(120);
    expect(next.red).toBe(60);
  });

  it('partial patch leaves the other faction unchanged', () => {
    const next = setPointValues({ blue: 10, red: 20 }, { blue: 50 });
    expect(next.blue).toBe(50);
    expect(next.red).toBe(20);
  });

  it('clamps negative values to 0', () => {
    const next = setPointValues({ blue: 5, red: 5 }, { blue: -1, red: -99 });
    expect(next.blue).toBe(0);
    expect(next.red).toBe(0);
  });

  it('does not mutate the input', () => {
    const original = { blue: 7, red: 8 };
    setPointValues(original, { blue: 1 });
    expect(original.blue).toBe(7);
  });
});

describe('createPointsLedger', () => {
  it('starts at 0 for both factions', () => {
    const ledger = createPointsLedger();
    expect(ledger.get()).toEqual({ blue: 0, red: 0 });
  });

  it('set overrides values', () => {
    const ledger = createPointsLedger();
    ledger.set({ blue: 145, red: 132 });
    expect(ledger.get()).toEqual({ blue: 145, red: 132 });
  });

  it('set with partial patch leaves the other faction unchanged', () => {
    const ledger = createPointsLedger();
    ledger.set({ blue: 10, red: 20 });
    ledger.set({ red: 99 });
    expect(ledger.get().blue).toBe(10);
    expect(ledger.get().red).toBe(99);
  });
});
