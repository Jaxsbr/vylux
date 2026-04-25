// Sim-state hashing for desync detection.
//
// FNV-1a 64-bit. Not cryptographic — we don't need it to be. Tick-by-tick
// hash comparison surfaces divergence at the moment it happens; one tick of
// drift produces a different hash, and the harness can binary-search the
// input log to locate it.
//
// We use a 64-bit hash held as a BigInt so the result is bit-stable across
// engines without relying on uint64 quirks of plain Numbers. SHA-256 is
// available via crypto.subtle if a cryptographic hash is ever needed, but
// SubtleCrypto is async — we keep the per-tick hash sync.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = (1n << 64n) - 1n;

export class Hasher {
  private state: bigint;

  constructor() {
    this.state = FNV_OFFSET;
  }

  writeByte(b: number): void {
    this.state = ((this.state ^ BigInt(b & 0xff)) * FNV_PRIME) & MASK_64;
  }

  // Mix a signed 32-bit integer (Q16.16 fixed-point values land here).
  writeI32(n: number): void {
    const u = (n | 0) >>> 0;
    this.writeByte(u & 0xff);
    this.writeByte((u >>> 8) & 0xff);
    this.writeByte((u >>> 16) & 0xff);
    this.writeByte((u >>> 24) & 0xff);
  }

  writeU32(n: number): void {
    this.writeI32(n);
  }

  // Mix a 64-bit value (PRNG state, big counters).
  writeU64(n: bigint): void {
    const masked = n & MASK_64;
    this.writeI32(Number(masked & 0xffffffffn));
    this.writeI32(Number((masked >> 32n) & 0xffffffffn));
  }

  // Mix an array of i32 values. Length is mixed first to make different-length
  // sequences hash differently even if their content overlaps.
  writeI32Array(arr: ReadonlyArray<number>): void {
    this.writeU32(arr.length);
    for (let i = 0; i < arr.length; i++) {
      this.writeI32(arr[i]);
    }
  }

  digest(): bigint {
    return this.state;
  }

  // Hex string for log-friendly comparison. 16 chars, no prefix.
  digestHex(): string {
    return this.state.toString(16).padStart(16, '0');
  }
}

// Convenience: hash a flat array of i32 in one shot.
export function hashI32Array(arr: ReadonlyArray<number>): string {
  const h = new Hasher();
  h.writeI32Array(arr);
  return h.digestHex();
}
