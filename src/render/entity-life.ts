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

// Building breathe: a slow emissive swell. Additive and always ≥ 0 — the swell
// only brightens, never dims below the resting glow. Used for the dark body
// tiers so they glow up gently from their near-black resting silhouette.
export const BUILDING_BREATHE_PERIOD_S = 3.2;
export const BUILDING_BREATHE_DELTA = 0.6;

// Building/node pulse: a *symmetric* emissive swing (dims AND brightens) around
// a resting base, with enough amplitude to read at a glance. Used for the
// bright accent caps + node cores — a brighten-only swell on an already-bright,
// near-bloom-saturated cap reads as nothing, so the cap needs to visibly dim
// too. Default period is a touch quicker than the body breathe so the bright
// element feels like the "pulse" and the body the slower "breath".
export const BUILDING_PULSE_PERIOD_S = 2.8;

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

// Symmetric emissive pulse in [-amplitude, +amplitude]. Add it to a resting
// base for a bright element that should visibly dim and brighten (clamp ≥ 0 at
// the call site if base - amplitude could go negative).
export function pulse(
  clockS: number,
  amplitude: number,
  period = BUILDING_PULSE_PERIOD_S,
): number {
  return Math.sin((clockS / period) * TAU) * amplitude;
}

// --- luminance-equalised emissive (faction-consistent bloom) ----------------
//
// The faction accent/charge caps share one emissiveIntensity range but
// different emissive *colours* — cyan is luminous, red-orange is much darker.
// Pulsing the *intensity* identically makes the red cap dip below the bloom
// luminance knee (it flickers on/off there) while the cyan cap, which never
// crosses the knee, modulates smoothly. The fix is to pulse in *luminance*
// space — pick a target luminance curve that stays above the knee, then drive
// each cap's intensity to hit it via `intensityForLuma`. Both factions then
// render the same bloom pulse regardless of colour.

// One sRGB channel (0..1) → linear. Three.js converts material colours to
// linear before the shader, and the bloom pass reads that linear buffer.
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

// Rendered luminance of an emissive `hex` at intensity 1. Computed in LINEAR
// space (the scene buffer the bloom high-pass reads — tone mapping + sRGB are
// applied later, in OutputPass, after bloom) with the Rec. 601 weights
// UnrealBloomPass uses. Working in sRGB here badly under-rates dark colours
// like the red-orange faction (whose low green/blue channels collapse under
// sRGB→linear), which is exactly what made the red cap dip onto the bloom knee.
export function colorLuma(hex: number): number {
  const r = srgbToLinear(((hex >> 16) & 0xff) / 255);
  const g = srgbToLinear(((hex >> 8) & 0xff) / 255);
  const b = srgbToLinear((hex & 0xff) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// The emissiveIntensity needed to render an emissive of colour `hex` at
// `targetLuma` rendered luminance. Dividing the shared luminance curve by each
// faction colour's luma equalises their bloom pulse.
export function intensityForLuma(hex: number, targetLuma: number): number {
  const luma = colorLuma(hex);
  return luma > 0 ? targetLuma / luma : 0;
}
