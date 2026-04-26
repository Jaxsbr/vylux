// Pure harvest-pulse curve: emissive intensity spike tied to income ticks.
// No Three.js — just a time → intensity mapping. Tested in isolation.

// Duration of the pulse in seconds. Matches the ~180ms spec target.
export const PULSE_DURATION = 0.18;

// Peak intensity added on top of the worker's base accent emissive.
// Base is WORKER_CONSTANTS.accentEmissiveIntensity (2.0); peak adds 3.0 → 5.0 total.
export const PULSE_PEAK_DELTA = 3.0;

/**
 * Returns a [0, 1] factor representing how far through the pulse we are.
 * Uses a fast linear attack (0 → 1 in the first 30ms) then exponential decay
 * back to 0 over the remaining PULSE_DURATION.
 *
 * @param elapsedSinceTick - Seconds since the last NODE_INCOME tick fired for this worker.
 * @param pulseDuration    - Total duration of the pulse window (seconds).
 * @returns A factor in [0, 1]. 0 means no pulse (either not yet started or fully decayed).
 */
export function harvestPulseFactor(
  elapsedSinceTick: number,
  pulseDuration: number,
): number {
  if (elapsedSinceTick < 0 || elapsedSinceTick >= pulseDuration) return 0;

  const t = elapsedSinceTick / pulseDuration; // [0, 1)
  const ATTACK = 0.17; // fraction of pulse spent in attack phase

  if (t < ATTACK) {
    // Fast linear ramp to peak.
    return t / ATTACK;
  }
  // Exponential decay from peak back to zero.
  const decayT = (t - ATTACK) / (1 - ATTACK); // [0, 1)
  return 1 - decayT * decayT;
}

/**
 * Compute the emissive intensity for the worker accent ring during a harvest pulse.
 *
 * @param baseIntensity    - Resting emissive intensity when not pulsing.
 * @param peakDelta        - Maximum additive intensity at pulse peak.
 * @param elapsedSinceTick - Seconds since the last tick fired; negative = no active pulse.
 * @param pulseDuration    - Total duration of the pulse window (seconds).
 * @returns The target emissive intensity to set on the accent material.
 */
export function harvestPulseIntensity(
  baseIntensity: number,
  peakDelta: number,
  elapsedSinceTick: number,
  pulseDuration: number,
): number {
  const factor = harvestPulseFactor(elapsedSinceTick, pulseDuration);
  return baseIntensity + peakDelta * factor;
}
