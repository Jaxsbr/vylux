import { describe, it, expect } from 'vitest';
import {
  eventPulseFactor,
  placementPulseScale,
  eventPulseIntensity,
  PLACEMENT_PULSE_DURATION,
  DEATH_PULSE_DURATION,
  CAPTURE_PULSE_DURATION,
  DEATH_PULSE_PEAK_DELTA,
  CAPTURE_PULSE_PEAK_DELTA,
  PLACEMENT_PULSE_SCALE_START,
} from './event-pulse';

const EPSILON = 0.001;

describe('eventPulseFactor', () => {
  it('returns 0 for negative elapsed', () => {
    expect(eventPulseFactor(-0.01, 0.2)).toBe(0);
    expect(eventPulseFactor(-1, 0.2)).toBe(0);
  });

  it('returns 0 at elapsed=0 (attack phase starts at 0)', () => {
    expect(eventPulseFactor(0, 0.2)).toBeCloseTo(0);
  });

  it('peaks near 1 at 20% of duration (end of attack phase)', () => {
    const dur = 0.2;
    const attackEnd = dur * 0.2;
    expect(eventPulseFactor(attackEnd, dur)).toBeCloseTo(1.0, 2);
  });

  it('returns 0 at elapsed >= duration (fully decayed)', () => {
    expect(eventPulseFactor(0.2, 0.2)).toBe(0);
    expect(eventPulseFactor(0.5, 0.2)).toBe(0);
  });

  it('factor stays in [0, 1] for all durations', () => {
    const durations = [PLACEMENT_PULSE_DURATION, DEATH_PULSE_DURATION, CAPTURE_PULSE_DURATION];
    for (const dur of durations) {
      for (let ms = 0; ms <= Math.ceil(dur * 1000) + 10; ms += 5) {
        const f = eventPulseFactor(ms / 1000, dur);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1 + EPSILON);
      }
    }
  });

  it('monotonically increases during attack phase', () => {
    const dur = 0.2;
    const attackEnd = dur * 0.2;
    const steps = 10;
    for (let i = 0; i < steps - 1; i++) {
      const t0 = (i / steps) * attackEnd;
      const t1 = ((i + 1) / steps) * attackEnd;
      expect(eventPulseFactor(t0, dur)).toBeLessThanOrEqual(
        eventPulseFactor(t1, dur) + EPSILON,
      );
    }
  });

  it('monotonically decreases during decay phase', () => {
    const dur = 0.2;
    const attackEnd = dur * 0.2;
    const steps = 10;
    for (let i = 0; i < steps - 1; i++) {
      const t0 = attackEnd + (i / steps) * (dur - attackEnd);
      const t1 = attackEnd + ((i + 1) / steps) * (dur - attackEnd);
      const f0 = eventPulseFactor(t0, dur);
      const f1 = eventPulseFactor(t1, dur);
      expect(f0).toBeGreaterThanOrEqual(f1 - EPSILON);
    }
  });
});

describe('placementPulseScale', () => {
  it('returns scaleStart at elapsed near 0', () => {
    // At t=0 factor=0, so scale = scaleStart + (1-scaleStart)*0 = scaleStart
    expect(placementPulseScale(0, PLACEMENT_PULSE_DURATION, PLACEMENT_PULSE_SCALE_START)).toBeCloseTo(
      PLACEMENT_PULSE_SCALE_START,
    );
  });

  it('returns ~1.0 at end of attack phase (peak)', () => {
    const attackEnd = PLACEMENT_PULSE_DURATION * 0.2;
    const scale = placementPulseScale(attackEnd, PLACEMENT_PULSE_DURATION, PLACEMENT_PULSE_SCALE_START);
    expect(scale).toBeCloseTo(1.0, 2);
  });

  it('returns 1.0 when elapsed >= duration (settled)', () => {
    expect(placementPulseScale(PLACEMENT_PULSE_DURATION, PLACEMENT_PULSE_DURATION, 0.4)).toBe(1.0);
    expect(placementPulseScale(1.0, PLACEMENT_PULSE_DURATION, 0.4)).toBe(1.0);
  });

  it('returns 1.0 for negative elapsed (no active pulse)', () => {
    expect(placementPulseScale(-0.01, PLACEMENT_PULSE_DURATION, 0.4)).toBe(1.0);
  });

  it('scale stays within [scaleStart, 1.0] across the entire pulse window', () => {
    const start = PLACEMENT_PULSE_SCALE_START;
    for (let ms = 0; ms <= 210; ms += 5) {
      const s = placementPulseScale(ms / 1000, PLACEMENT_PULSE_DURATION, start);
      expect(s).toBeGreaterThanOrEqual(start - EPSILON);
      expect(s).toBeLessThanOrEqual(1.0 + EPSILON);
    }
  });
});

describe('eventPulseIntensity', () => {
  it('returns baseIntensity when not pulsing (negative elapsed)', () => {
    expect(eventPulseIntensity(2.0, DEATH_PULSE_PEAK_DELTA, -1, DEATH_PULSE_DURATION)).toBeCloseTo(2.0);
  });

  it('returns baseIntensity when pulse fully decayed', () => {
    expect(eventPulseIntensity(2.0, DEATH_PULSE_PEAK_DELTA, DEATH_PULSE_DURATION, DEATH_PULSE_DURATION)).toBeCloseTo(2.0);
  });

  it('peaks at base + peakDelta at end of attack phase', () => {
    const base = 2.0;
    const dur = DEATH_PULSE_DURATION;
    const attackEnd = dur * 0.2;
    const intensity = eventPulseIntensity(base, DEATH_PULSE_PEAK_DELTA, attackEnd, dur);
    expect(intensity).toBeCloseTo(base + DEATH_PULSE_PEAK_DELTA, 1);
  });

  it('capture pulse peaks at base + CAPTURE_PULSE_PEAK_DELTA', () => {
    const base = 1.0;
    const dur = CAPTURE_PULSE_DURATION;
    const attackEnd = dur * 0.2;
    const intensity = eventPulseIntensity(base, CAPTURE_PULSE_PEAK_DELTA, attackEnd, dur);
    expect(intensity).toBeCloseTo(base + CAPTURE_PULSE_PEAK_DELTA, 1);
  });

  it('intensity stays non-negative for any elapsed/duration', () => {
    for (let ms = 0; ms <= 300; ms += 5) {
      const v = eventPulseIntensity(0, DEATH_PULSE_PEAK_DELTA, ms / 1000, DEATH_PULSE_DURATION);
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
