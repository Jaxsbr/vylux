// Seeded pseudo-random number generator for the sim.
//
// Uses splitmix64 — a small, fast, well-tested PRNG. State is a single
// 64-bit integer (held as a BigInt so the sim is bit-stable across JS
// engines that don't all agree on uint64 arithmetic in plain Numbers).
//
// One instance per match, seeded from the match seed sent in the lobby
// handshake. Forbidden in sim code: `Math.random()`, time-based seeds,
// any second RNG instance. If a feature needs randomness, it asks `this`
// RNG and accepts the determinism contract.

const MASK_64 = (1n << 64n) - 1n;
const MASK_32 = 0xffffffffn;
const STEP = 0x9e3779b97f4a7c15n;
const MIX_1 = 0xbf58476d1ce4e5b9n;
const MIX_2 = 0x94d049bb133111ebn;

export class Rng {
  private state: bigint;

  constructor(seed: number | bigint) {
    // Normalise to a 64-bit BigInt. Negative or oversized seeds are masked
    // rather than rejected — call sites pass match-id-derived hashes, not
    // user input.
    const s = typeof seed === 'bigint' ? seed : BigInt(seed >>> 0);
    this.state = s & MASK_64;
  }

  // Advance state and return the next 64-bit value. Public so the hash
  // serializer can include RNG state without exposing the constant.
  nextU64(): bigint {
    this.state = (this.state + STEP) & MASK_64;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * MIX_1) & MASK_64;
    z = ((z ^ (z >> 27n)) * MIX_2) & MASK_64;
    z = (z ^ (z >> 31n)) & MASK_64;
    return z;
  }

  // Uniform unsigned 32-bit integer. Use this for any branch that needs
  // a "random integer" — easier to reason about than nextU64 for most
  // sim code.
  nextU32(): number {
    return Number(this.nextU64() & MASK_32) >>> 0;
  }

  // Integer in [0, n). Uses the multiply-and-shift trick to avoid modulo
  // bias. Throws on n <= 0 — that's a sim bug, not a value to silently
  // clamp.
  nextInt(n: number): number {
    if (n <= 0) throw new Error('rng nextInt: n must be > 0');
    // (u32 * n) >> 32 gives uniform [0, n) when u32 is uniform [0, 2^32).
    const r = BigInt(this.nextU32()) * BigInt(n);
    return Number(r >> 32n);
  }

  // Snapshot the current state for serialisation (replay record / state
  // hash). Restoration: `new Rng(snapshot)`.
  snapshot(): bigint {
    return this.state;
  }
}
