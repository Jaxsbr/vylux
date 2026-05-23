import { describe, expect, it } from 'vitest';
import {
  BUILDING_BREATHE_DELTA,
  BUILDING_BREATHE_PERIOD_S,
  BUILDING_PULSE_PERIOD_S,
  WORKER_HOVER_AMPLITUDE,
  WORKER_HOVER_BASE,
  WORKER_HOVER_PERIOD_S,
  breathe,
  colorLuma,
  intensityForLuma,
  phaseOffset,
  pulse,
  workerHover,
} from './entity-life';

// Faction emissive hexes (must match meshes.ts / legacy).
const CYAN = 0x00e0ff; // swarm
const RED = 0xff4a1a;  // siege

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

describe('pulse', () => {
  it('is zero at the start and dims as well as brightens (symmetric)', () => {
    expect(pulse(0, 1.2)).toBeCloseTo(0, 6);
    expect(pulse(BUILDING_PULSE_PERIOD_S / 4, 1.2)).toBeCloseTo(1.2, 6);
    expect(pulse((BUILDING_PULSE_PERIOD_S * 3) / 4, 1.2)).toBeCloseTo(-1.2, 6);
  });

  it('stays within ±amplitude across the cycle', () => {
    for (let t = 0; t <= BUILDING_PULSE_PERIOD_S; t += BUILDING_PULSE_PERIOD_S / 64) {
      expect(Math.abs(pulse(t, 1.0))).toBeLessThanOrEqual(1.0 + 1e-9);
    }
  });
});

describe('luminance-equalised emissive', () => {
  it('rates the red-orange siege emissive as much less luminous than cyan', () => {
    expect(colorLuma(CYAN)).toBeGreaterThan(colorLuma(RED));
  });

  it('computes luma in LINEAR space (the buffer the bloom pass reads)', () => {
    // White is 1.0 either way; black is 0.
    expect(colorLuma(0xffffff)).toBeCloseTo(1, 6);
    expect(colorLuma(0x000000)).toBe(0);
    // A mid sRGB grey (0x80 ≈ 0.502 sRGB) linearises to ~0.216 — far below its
    // sRGB value. If this regressed to a raw-sRGB luma it'd read ~0.502.
    expect(colorLuma(0x808080)).toBeLessThan(0.3);
  });

  it('drives the dim red cap to a higher intensity than the luminous cyan cap for the same luminance', () => {
    // This is the whole point: red must run brighter to hit the same on-screen
    // luminance, so it tracks cyan's bloom pulse instead of crossing the knee.
    expect(intensityForLuma(RED, 1.0)).toBeGreaterThan(intensityForLuma(CYAN, 1.0));
  });

  it('hits exactly the target luminance for either faction across the pulse', () => {
    for (const hex of [CYAN, RED]) {
      for (const targetLuma of [0.75, 1.35, 1.95]) {
        expect(intensityForLuma(hex, targetLuma) * colorLuma(hex)).toBeCloseTo(targetLuma, 6);
      }
    }
  });

  it('returns 0 for a pure-black emissive (no luminance to drive)', () => {
    expect(intensityForLuma(0x000000, 1.0)).toBe(0);
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
