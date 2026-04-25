import { describe, expect, it } from 'vitest';
import {
  FIXED_ONE,
  FIXED_HALF,
  abs,
  add,
  distSq,
  div,
  fromFloat,
  fromInt,
  max,
  min,
  mul,
  neg,
  rangeSq,
  sub,
  toFloat,
  toInt,
} from './fixed';

describe('Q16.16 fixed-point', () => {
  describe('conversion', () => {
    it('round-trips small integers', () => {
      for (const n of [-1000, -1, 0, 1, 7, 100, 1000]) {
        expect(toInt(fromInt(n))).toBe(n);
      }
    });

    it('round-trips representable floats', () => {
      // 0.5 is exactly representable in Q16.16 (32768 / 65536).
      expect(toFloat(fromFloat(0.5))).toBe(0.5);
      expect(toFloat(fromFloat(-0.25))).toBe(-0.25);
      expect(toFloat(fromFloat(3.140625))).toBe(3.140625);
    });

    it('FIXED_ONE = 65536', () => {
      expect(FIXED_ONE).toBe(65536);
    });

    it('FIXED_HALF represents 0.5', () => {
      expect(toFloat(FIXED_HALF)).toBe(0.5);
    });
  });

  describe('add / sub / neg', () => {
    it('integer addition', () => {
      expect(toInt(add(fromInt(3), fromInt(4)))).toBe(7);
    });

    it('fractional addition is exact for representable values', () => {
      const half = fromFloat(0.5);
      const quarter = fromFloat(0.25);
      expect(toFloat(add(half, quarter))).toBe(0.75);
    });

    it('subtraction round-trips through add', () => {
      const a = fromInt(123);
      const b = fromInt(45);
      expect(sub(add(a, b), b)).toBe(a);
    });

    it('neg is its own inverse', () => {
      const a = fromInt(7);
      expect(neg(neg(a))).toBe(a);
    });
  });

  describe('mul / div', () => {
    it('integer multiplication', () => {
      expect(toInt(mul(fromInt(6), fromInt(7)))).toBe(42);
    });

    it('mul stays correct when raw product exceeds 32 bits', () => {
      // 100 × 100 = 10000 (in range of Q16.16, max ±32768).
      // But raw_a × raw_b = 6_553_600 × 6_553_600 ≈ 4.3e13, far above 2^32.
      // Naive `(a * b) >> 16` truncates to int32 first via JS bitwise ops
      // and produces the wrong answer — the BigInt route in `mul` is what
      // keeps this correct.
      expect(toInt(mul(fromInt(100), fromInt(100)))).toBe(10000);
      expect(toInt(mul(fromInt(150), fromInt(200)))).toBe(30000);
    });

    it('mul is bit-stable across runs', () => {
      // Same operands → same exact int32. Repeat many times; if engine
      // intermediate precision is leaking, this drifts.
      const a = fromFloat(1.5);
      const b = fromFloat(2.25);
      const expected = mul(a, b);
      for (let i = 0; i < 10000; i++) {
        expect(mul(a, b)).toBe(expected);
      }
    });

    it('div is the inverse of mul for representable values', () => {
      const a = fromInt(100);
      const b = fromInt(5);
      expect(div(mul(a, b), b)).toBe(a);
    });

    it('div by zero throws', () => {
      expect(() => div(fromInt(1), 0)).toThrow();
    });
  });

  describe('distance helpers', () => {
    it('distSq is exact integer for integer coords', () => {
      // (3, 4) -> (0, 0) → 3² + 4² = 25
      const d = distSq(fromInt(3), fromInt(4), fromInt(0), fromInt(0));
      expect(toInt(d)).toBe(25);
    });

    it('distSq handles negatives correctly', () => {
      const d = distSq(fromInt(-3), fromInt(0), fromInt(0), fromInt(4));
      expect(toInt(d)).toBe(25);
    });

    it('rangeSq is range squared', () => {
      const r = rangeSq(fromInt(5));
      expect(toInt(r)).toBe(25);
    });

    it('range comparison is the intended pattern', () => {
      // Unit at (0,0) with range 5; target at (3,4) → in range.
      const inRange = distSq(fromInt(0), fromInt(0), fromInt(3), fromInt(4));
      const range = rangeSq(fromInt(5));
      expect(inRange <= range).toBe(true);

      // Same unit, target at (4,4) → 32 > 25 → out of range.
      const outOfRange = distSq(fromInt(0), fromInt(0), fromInt(4), fromInt(4));
      expect(outOfRange > range).toBe(true);
    });
  });

  describe('abs / min / max', () => {
    it('abs of negative', () => {
      expect(abs(fromInt(-7))).toBe(fromInt(7));
    });

    it('abs of positive is identity', () => {
      expect(abs(fromInt(7))).toBe(fromInt(7));
    });

    it('min / max', () => {
      expect(min(fromInt(3), fromInt(8))).toBe(fromInt(3));
      expect(max(fromInt(3), fromInt(8))).toBe(fromInt(8));
    });
  });

  describe('determinism property', () => {
    // The whole point of this module: repeated runs of the same op produce
    // the exact same int32 every time, regardless of how warm the JIT is.
    it('mul/div/add chain is reproducible across many iterations', () => {
      const seed = fromFloat(1.7);
      let acc = seed;
      const sequence: number[] = [];
      for (let i = 0; i < 1000; i++) {
        acc = add(mul(acc, fromFloat(1.001)), fromInt(1));
        if (i % 100 === 0) sequence.push(acc);
      }

      // Run again from the same seed.
      let acc2 = seed;
      const sequence2: number[] = [];
      for (let i = 0; i < 1000; i++) {
        acc2 = add(mul(acc2, fromFloat(1.001)), fromInt(1));
        if (i % 100 === 0) sequence2.push(acc2);
      }

      expect(sequence).toEqual(sequence2);
    });
  });
});
