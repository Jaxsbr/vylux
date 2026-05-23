// Continuous "alive at rest" + motion curves for entities.
//
// Phase C.4 — game-feel: motion & world life. The re-scoped C.4 makes the
// arena feel alive through its *entities* (workers, HQ, pods) rather than a
// moving backdrop. These are the renderer-only animation primitives behind
// that: a slow vertical hover so a standing worker reads alive, and a slow
// emissive swell so an operational building "breathes" instead of sitting
// switched-off.
//
// Pure math — a phase clock in, a scalar out — so the curves are unit-tested
// in isolation (same pattern as `event-pulse.ts`) and never touch the
// deterministic sim. The renderer owns the clock; nothing here is stateful.

const TAU = Math.PI * 2;

// --- tuning ----------------------------------------------------------------

// Worker idle hover: a slow vertical lift so a standing worker reads alive
// without drifting off its tile. The value is a *positive* offset applied to
// the worker body only (not its selection ring) — so the body lifts off the
// floor and settles back, but never dips below its resting floor contact
// (which clipped the grid). Amplitude/base are world units; base ≈ amplitude
// keeps the trough just kissing the floor, the way a symmetric bob did,
// without ever penetrating it.
export const WORKER_HOVER_PERIOD_S = 2.4;
export const WORKER_HOVER_BASE = 0.032;
export const WORKER_HOVER_AMPLITUDE = 0.03;

// Building breathe: a slow emissive swell layered on the bright accent cap so
// structures glow like they're idling, not powered down. Additive and always
// ≥ 0, so the building's built-look intensity is the floor — the swell only
// ever brightens, never dims the building below its resting glow.
export const BUILDING_BREATHE_PERIOD_S = 3.2;
export const BUILDING_BREATHE_DELTA = 0.6;

// --- curves ----------------------------------------------------------------

// Per-entity phase offset so a crowd of workers / a row of buildings don't
// pulse in lockstep (which reads as mechanical). A golden-ratio scramble of
// the integer id spreads ids evenly across the period.
export function phaseOffset(id: number, period: number): number {
  const frac = (id * 0.618033988749895) % 1;
  return frac * period;
}

// Positive vertical hover offset (world units) for a standing/idle worker.
// `base ± amplitude`, and with base ≥ amplitude the result is always ≥ 0, so
// the body never drops below its resting floor contact. Applied to the worker
// body only — the selection ring stays pinned to the floor.
export function workerHover(
  clockS: number,
  base = WORKER_HOVER_BASE,
  amplitude = WORKER_HOVER_AMPLITUDE,
  period = WORKER_HOVER_PERIOD_S,
): number {
  return base + Math.sin((clockS / period) * TAU) * amplitude;
}

// Additive emissive swell (≥ 0) for an operational building at rest. A raised
// cosine so the swell sits at 0 at the trough and `delta` at the peak — added
// on top of whatever resting intensity the building's build-progress set.
export function breathe(
  clockS: number,
  delta = BUILDING_BREATHE_DELTA,
  period = BUILDING_BREATHE_PERIOD_S,
): number {
  return (0.5 - 0.5 * Math.cos((clockS / period) * TAU)) * delta;
}
