// Pure event-pulse curve — shared attack+decay shape for place/death/capture events.
// No Three.js, no DOM. Time → [0,1] factor, tested in isolation.
//
// Same shape as worker-harvest-pulse but parameterised for different durations.
// All four event pulses share this curve; callers supply their own duration/peak.

/** Duration constants for each event type, in seconds. */
export const PLACEMENT_PULSE_DURATION = 0.2;  // 200ms scale-in
export const DEATH_PULSE_DURATION = 0.15;     // 150ms emissive spike
export const CAPTURE_PULSE_DURATION = 0.25;   // 250ms rim emissive spike
export const POINT_FLASH_DURATION = 0.18;     // 180ms CSS class (matches harvest)

/** Peak emissive delta for death and capture pulses. */
export const DEATH_PULSE_PEAK_DELTA = 4.0;
export const CAPTURE_PULSE_PEAK_DELTA = 3.5;
export const PLACEMENT_PULSE_SCALE_START = 0.4;

/**
 * Returns a [0, 1] factor for the event pulse curve.
 * Fast linear attack (0→1 in first 20% of duration) then quadratic decay back to 0.
 *
 * @param elapsed  Seconds since the event fired (negative → 0).
 * @param duration Total pulse window in seconds.
 */
export function eventPulseFactor(elapsed: number, duration: number): number {
  if (elapsed < 0 || elapsed >= duration) return 0;

  const t = elapsed / duration; // [0, 1)
  const ATTACK = 0.2; // fraction spent in attack phase

  if (t < ATTACK) {
    return t / ATTACK;
  }
  const decayT = (t - ATTACK) / (1 - ATTACK);
  return 1 - decayT * decayT;
}

/**
 * Placement scale: lerp from scaleStart to 1.0 at pulse peak, back to 1.0 at end.
 * Returns the mesh scale.x/.y/.z to apply.
 *
 * @param elapsed    Seconds since placement.
 * @param duration   Placement pulse duration in seconds.
 * @param scaleStart Scale at t=0 (e.g. 0.4).
 */
export function placementPulseScale(
  elapsed: number,
  duration: number,
  scaleStart: number,
): number {
  if (elapsed < 0 || elapsed >= duration) return 1.0;
  const factor = eventPulseFactor(elapsed, duration);
  // ease-out: start at scaleStart, reach 1.0 quickly, stay there.
  // We want: scale = scaleStart + (1 - scaleStart) * factor
  return scaleStart + (1 - scaleStart) * factor;
}

/**
 * Emissive intensity during a death or capture pulse.
 *
 * @param baseIntensity  Resting intensity.
 * @param peakDelta      Additive intensity at peak.
 * @param elapsed        Seconds since event.
 * @param duration       Total pulse duration.
 */
export function eventPulseIntensity(
  baseIntensity: number,
  peakDelta: number,
  elapsed: number,
  duration: number,
): number {
  const factor = eventPulseFactor(elapsed, duration);
  return baseIntensity + peakDelta * factor;
}
