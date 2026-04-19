import { describe, it, expect } from 'vitest';
import {
  harvestPulseFactor,
  harvestPulseIntensity,
  PULSE_DURATION,
  PULSE_PEAK_DELTA,
} from './worker-harvest-pulse';

const BASE = 2.0;
const EPSILON = 0.001;

describe('harvestPulseFactor', () => {
  it('returns 0 at exactly elapsed=0 (just started — attack not yet registered)', () => {
    // t=0 → factor = 0/ATTACK = 0
    expect(harvestPulseFactor(0, PULSE_DURATION)).toBeCloseTo(0);
  });

  it('peaks near 1 within the first ~30ms of the pulse window', () => {
    // Attack phase ends at 17% of duration (~30.6ms for 180ms duration).
    const attackEnd = PULSE_DURATION * 0.17;
    const factorAtAttackEnd = harvestPulseFactor(attackEnd, PULSE_DURATION);
    expect(factorAtAttackEnd).toBeCloseTo(1.0, 2);
  });

  it('returns 0 at elapsed >= pulseDuration (fully decayed)', () => {
    expect(harvestPulseFactor(PULSE_DURATION, PULSE_DURATION)).toBe(0);
    expect(harvestPulseFactor(PULSE_DURATION + 1, PULSE_DURATION)).toBe(0);
  });

  it('returns 0 for negative elapsed (no active pulse)', () => {
    expect(harvestPulseFactor(-0.01, PULSE_DURATION)).toBe(0);
    expect(harvestPulseFactor(-1, PULSE_DURATION)).toBe(0);
  });

  it('monotonically increases during attack phase', () => {
    const steps = 10;
    const attackEnd = PULSE_DURATION * 0.17;
    for (let i = 0; i < steps - 1; i++) {
      const t0 = (i / steps) * attackEnd;
      const t1 = ((i + 1) / steps) * attackEnd;
      expect(harvestPulseFactor(t0, PULSE_DURATION))
        .toBeLessThanOrEqual(harvestPulseFactor(t1, PULSE_DURATION));
    }
  });

  it('monotonically decreases during decay phase', () => {
    const attackEnd = PULSE_DURATION * 0.17;
    const steps = 10;
    for (let i = 0; i < steps - 1; i++) {
      const t0 = attackEnd + (i / steps) * (PULSE_DURATION - attackEnd);
      const t1 = attackEnd + ((i + 1) / steps) * (PULSE_DURATION - attackEnd);
      const f0 = harvestPulseFactor(t0, PULSE_DURATION);
      const f1 = harvestPulseFactor(t1, PULSE_DURATION);
      expect(f0).toBeGreaterThanOrEqual(f1 - EPSILON);
    }
  });

  it('factor stays within [0, 1] for all valid elapsed values', () => {
    for (let ms = 0; ms <= 200; ms += 5) {
      const f = harvestPulseFactor(ms / 1000, PULSE_DURATION);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1 + EPSILON);
    }
  });
});

describe('harvestPulseIntensity', () => {
  it('returns base intensity when elapsed is negative (off-node baseline)', () => {
    expect(harvestPulseIntensity(BASE, PULSE_PEAK_DELTA, -1, PULSE_DURATION)).toBeCloseTo(BASE);
  });

  it('returns base intensity when pulse has fully decayed', () => {
    expect(harvestPulseIntensity(BASE, PULSE_PEAK_DELTA, PULSE_DURATION, PULSE_DURATION)).toBeCloseTo(BASE);
    expect(harvestPulseIntensity(BASE, PULSE_PEAK_DELTA, PULSE_DURATION + 1, PULSE_DURATION)).toBeCloseTo(BASE);
  });

  it('peaks above base by peakDelta during attack phase', () => {
    const attackEnd = PULSE_DURATION * 0.17;
    const intensity = harvestPulseIntensity(BASE, PULSE_PEAK_DELTA, attackEnd, PULSE_DURATION);
    expect(intensity).toBeCloseTo(BASE + PULSE_PEAK_DELTA, 1);
  });

  it('off-node baseline never varies — sampled values are identical', () => {
    // Simulating off-node: elapsed is always -1 (no tick ever fires).
    const samples = [0, 0.05, 0.1, 0.2, 0.5, 1.0].map(
      (_t) => harvestPulseIntensity(BASE, PULSE_PEAK_DELTA, -1, PULSE_DURATION),
    );
    // All samples should equal BASE exactly.
    for (const s of samples) {
      expect(s).toBeCloseTo(BASE);
    }
  });

  it('on-node pulse shows non-trivial variation — peak clearly above base', () => {
    // Simulate: tick fires at t=0, we sample every 5ms for 200ms.
    const samples: number[] = [];
    for (let ms = 0; ms <= 200; ms += 5) {
      samples.push(harvestPulseIntensity(BASE, PULSE_PEAK_DELTA, ms / 1000, PULSE_DURATION));
    }
    const peak = Math.max(...samples);
    const min = Math.min(...samples);
    // Peak should be well above base; total variation should exceed PULSE_PEAK_DELTA * 0.5.
    expect(peak).toBeGreaterThan(BASE + PULSE_PEAK_DELTA * 0.8);
    expect(peak - min).toBeGreaterThan(PULSE_PEAK_DELTA * 0.5);
  });
});
