import { describe, expect, it } from 'vitest';
import {
  BUILDING_BREATHE_DELTA,
  BUILDING_BREATHE_PERIOD_S,
  WORKER_HOVER_AMPLITUDE,
  WORKER_HOVER_BASE,
  WORKER_HOVER_PERIOD_S,
  breathe,
  phaseOffset,
  workerHover,
} from './entity-life';

describe('workerHover', () => {
  it('sits at the resting base at the start of the cycle', () => {
    expect(workerHover(0)).toBeCloseTo(WORKER_HOVER_BASE, 6);
  });

  it('peaks at base+amplitude a quarter-period in and base-amplitude at three-quarters', () => {
    expect(workerHover(WORKER_HOVER_PERIOD_S / 4)).toBeCloseTo(WORKER_HOVER_BASE + WORKER_HOVER_AMPLITUDE, 6);
    expect(workerHover((WORKER_HOVER_PERIOD_S * 3) / 4)).toBeCloseTo(WORKER_HOVER_BASE - WORKER_HOVER_AMPLITUDE, 6);
  });

  it('never drops below the floor — the body must not clip the grid', () => {
    for (let t = 0; t <= WORKER_HOVER_PERIOD_S * 2; t += WORKER_HOVER_PERIOD_S / 128) {
      expect(workerHover(t)).toBeGreaterThanOrEqual(0);
    }
  });

  it('is periodic', () => {
    expect(workerHover(0.37)).toBeCloseTo(workerHover(0.37 + WORKER_HOVER_PERIOD_S), 6);
  });
});

describe('breathe', () => {
  it('sits at the trough (0) at the start of the cycle', () => {
    expect(breathe(0)).toBeCloseTo(0, 6);
  });

  it('reaches the full delta at the half-period peak', () => {
    expect(breathe(BUILDING_BREATHE_PERIOD_S / 2)).toBeCloseTo(BUILDING_BREATHE_DELTA, 6);
  });

  it('never goes negative — it only ever brightens', () => {
    for (let t = 0; t <= BUILDING_BREATHE_PERIOD_S * 2; t += BUILDING_BREATHE_PERIOD_S / 64) {
      expect(breathe(t)).toBeGreaterThanOrEqual(-1e-9);
      expect(breathe(t)).toBeLessThanOrEqual(BUILDING_BREATHE_DELTA + 1e-9);
    }
  });
});

describe('phaseOffset', () => {
  it('stays within [0, period)', () => {
    for (let id = 0; id < 200; id++) {
      const off = phaseOffset(id, WORKER_HOVER_PERIOD_S);
      expect(off).toBeGreaterThanOrEqual(0);
      expect(off).toBeLessThan(WORKER_HOVER_PERIOD_S);
    }
  });

  it('spreads neighbouring ids apart rather than clustering them', () => {
    // Golden-ratio scramble: consecutive ids should land far apart in phase,
    // so a freshly-trained worker doesn't bob in lockstep with its neighbour.
    const a = phaseOffset(10, 1);
    const b = phaseOffset(11, 1);
    expect(Math.abs(a - b)).toBeGreaterThan(0.1);
  });
});
