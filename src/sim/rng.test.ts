import { describe, expect, it } from 'vitest';
import { Rng } from './rng';

describe('Rng (splitmix64)', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) {
      expect(a.nextU32()).toBe(b.nextU32());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    // Collisions in the first ~10 outputs would suggest a broken PRNG.
    let collisions = 0;
    for (let i = 0; i < 10; i++) {
      if (a.nextU32() === b.nextU32()) collisions++;
    }
    expect(collisions).toBeLessThan(2);
  });

  it('matches a known splitmix64 reference sequence for seed=0', () => {
    // Reference values for splitmix64 starting at state=0 (well-known):
    //   0xe220a8397b1dcdaf
    //   0x6e789e6aa1b965f4
    //   0x06c45d188009454f
    // We verify the first three nextU64 outputs match.
    const r = new Rng(0);
    expect(r.nextU64()).toBe(0xe220a8397b1dcdafn);
    expect(r.nextU64()).toBe(0x6e789e6aa1b965f4n);
    expect(r.nextU64()).toBe(0x06c45d188009454fn);
  });

  it('nextInt(n) stays in [0, n)', () => {
    const r = new Rng(12345);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
  });

  it('nextInt(n) is roughly uniform', () => {
    const r = new Rng(99);
    const buckets = [0, 0, 0, 0];
    const N = 40000;
    for (let i = 0; i < N; i++) buckets[r.nextInt(4)]++;
    // Expected ~10000 per bucket. ±5% is generous; if we ever fail this
    // the PRNG is broken, not unlucky.
    for (const b of buckets) {
      expect(b).toBeGreaterThan(N / 4 * 0.95);
      expect(b).toBeLessThan(N / 4 * 1.05);
    }
  });

  it('nextInt(0) throws', () => {
    expect(() => new Rng(0).nextInt(0)).toThrow();
  });

  it('snapshot + reseed reproduces the sequence', () => {
    const r1 = new Rng(7);
    for (let i = 0; i < 50; i++) r1.nextU32();
    const snap = r1.snapshot();
    const next1 = [r1.nextU32(), r1.nextU32(), r1.nextU32()];

    const r2 = new Rng(snap);
    const next2 = [r2.nextU32(), r2.nextU32(), r2.nextU32()];

    expect(next1).toEqual(next2);
  });

  it('accepts BigInt seeds (for state restoration)', () => {
    const r1 = new Rng(0xdeadbeefn);
    const r2 = new Rng(0xdeadbeefn);
    expect(r1.nextU64()).toBe(r2.nextU64());
  });
});
