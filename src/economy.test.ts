import { describe, it, expect } from 'vitest';
import {
  BASE_INCOME,
  tickEnergy,
  setEnergyValues,
  createEnergyLedger,
} from './economy';

describe('BASE_INCOME', () => {
  it('is 1 energy per second', () => {
    expect(BASE_INCOME).toBe(1);
  });
});

describe('tickEnergy', () => {
  it('accrues BASE_INCOME for both factions over one second', () => {
    const next = tickEnergy({ blue: 0, red: 0 }, 1);
    expect(next.blue).toBeCloseTo(1);
    expect(next.red).toBeCloseTo(1);
  });

  it('accumulates correctly over multiple ticks', () => {
    let state = { blue: 0, red: 0 };
    for (let i = 0; i < 10; i++) {
      state = tickEnergy(state, 0.1);
    }
    expect(state.blue).toBeCloseTo(1, 5);
    expect(state.red).toBeCloseTo(1, 5);
  });

  it('does not mutate the input object', () => {
    const original = { blue: 5, red: 3 };
    const frozen = { ...original };
    tickEnergy(original, 1);
    expect(original.blue).toBe(frozen.blue);
    expect(original.red).toBe(frozen.red);
  });

  it('clamps to non-negative even with a negative delta', () => {
    const next = tickEnergy({ blue: 0, red: 0 }, -100);
    expect(next.blue).toBe(0);
    expect(next.red).toBe(0);
  });

  it('preserves existing balance when ticking', () => {
    const next = tickEnergy({ blue: 10, red: 20 }, 1);
    expect(next.blue).toBeCloseTo(11);
    expect(next.red).toBeCloseTo(21);
  });
});

describe('setEnergyValues', () => {
  it('overrides both factions', () => {
    const next = setEnergyValues({ blue: 0, red: 0 }, { blue: 42, red: 18 });
    expect(next.blue).toBe(42);
    expect(next.red).toBe(18);
  });

  it('partial patch leaves the other faction unchanged', () => {
    const next = setEnergyValues({ blue: 10, red: 20 }, { blue: 99 });
    expect(next.blue).toBe(99);
    expect(next.red).toBe(20);
  });

  it('clamps negative values to 0', () => {
    const next = setEnergyValues({ blue: 5, red: 5 }, { blue: -3, red: -1 });
    expect(next.blue).toBe(0);
    expect(next.red).toBe(0);
  });

  it('does not mutate the input', () => {
    const original = { blue: 7, red: 8 };
    setEnergyValues(original, { blue: 1 });
    expect(original.blue).toBe(7);
  });
});

describe('createEnergyLedger', () => {
  it('starts at 0 for both factions', () => {
    const ledger = createEnergyLedger();
    expect(ledger.get()).toEqual({ blue: 0, red: 0 });
  });

  it('tick advances energy by BASE_INCOME per second', () => {
    const ledger = createEnergyLedger();
    ledger.tick(2);
    expect(ledger.get().blue).toBeCloseTo(2);
    expect(ledger.get().red).toBeCloseTo(2);
  });

  it('set overrides values', () => {
    const ledger = createEnergyLedger();
    ledger.set({ blue: 50, red: 30 });
    expect(ledger.get()).toEqual({ blue: 50, red: 30 });
  });

  it('set with partial patch leaves the other faction at its current value', () => {
    const ledger = createEnergyLedger();
    ledger.tick(5);
    const before = ledger.get().red;
    ledger.set({ blue: 99 });
    expect(ledger.get().blue).toBe(99);
    expect(ledger.get().red).toBeCloseTo(before);
  });
});
