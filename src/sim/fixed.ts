// Q16.16 fixed-point arithmetic.
//
// All values affecting simulation state use this representation. Stored as a
// JavaScript Number, but logically a 32-bit signed integer where the low 16
// bits are fractional. Range: ±32768 with 1/65536 precision.
//
// Operations are designed to be bitwise reproducible across JS engines:
// add/sub use 32-bit wraparound (`| 0`), mul/div route through BigInt to
// avoid the 53-bit Number precision ceiling on intermediate products.
//
// This module is sim-internal. The renderer reads sim state and converts to
// floats at the boundary; nothing in this module should ever be called from
// `src/scene.ts` or any Three.js code path.

export type Fixed = number;

export const FIXED_SHIFT = 16;
export const FIXED_ONE: Fixed = 1 << FIXED_SHIFT;
export const FIXED_HALF: Fixed = FIXED_ONE >> 1;
export const FIXED_MAX: Fixed = 0x7fffffff;
export const FIXED_MIN: Fixed = -0x80000000;

const SHIFT_BIG = BigInt(FIXED_SHIFT);

export function fromInt(n: number): Fixed {
  return (n << FIXED_SHIFT) | 0;
}

export function fromFloat(f: number): Fixed {
  return Math.round(f * FIXED_ONE) | 0;
}

export function toFloat(x: Fixed): number {
  return x / FIXED_ONE;
}

export function toInt(x: Fixed): number {
  return x >> FIXED_SHIFT;
}

export function add(a: Fixed, b: Fixed): Fixed {
  return (a + b) | 0;
}

export function sub(a: Fixed, b: Fixed): Fixed {
  return (a - b) | 0;
}

export function neg(a: Fixed): Fixed {
  return (-a) | 0;
}

export function mul(a: Fixed, b: Fixed): Fixed {
  // Intermediate product can overflow 53-bit Number precision (Q16.16 ×
  // Q16.16 = up to Q32.32, ~64 bits). Route through BigInt for bit-stable
  // results across engines, then truncate back to Q16.16 int32.
  const product = BigInt(a) * BigInt(b);
  return Number(product >> SHIFT_BIG) | 0;
}

export function div(a: Fixed, b: Fixed): Fixed {
  if (b === 0) {
    // Deterministic poison: divide-by-zero in sim is a bug; surface it.
    throw new Error('fixed div by zero');
  }
  // (a << 16) / b, in BigInt to keep the numerator's precision.
  const numerator = BigInt(a) << SHIFT_BIG;
  return Number(numerator / BigInt(b)) | 0;
}

export function abs(a: Fixed): Fixed {
  return a < 0 ? ((-a) | 0) : a;
}

export function min(a: Fixed, b: Fixed): Fixed {
  return a < b ? a : b;
}

export function max(a: Fixed, b: Fixed): Fixed {
  return a > b ? a : b;
}

// Squared-distance helpers. Vylux sim never takes a sqrt — range checks
// always compare squared values. This keeps integer arithmetic exact.
export function distSq(ax: Fixed, ay: Fixed, bx: Fixed, by: Fixed): Fixed {
  const dx = sub(ax, bx);
  const dy = sub(ay, by);
  return add(mul(dx, dx), mul(dy, dy));
}

// Compute a range squared from a Fixed range value, suitable for use with
// distSq. `range * range` only: callers must compare distSq(...) <= rangeSq.
export function rangeSq(range: Fixed): Fixed {
  return mul(range, range);
}
