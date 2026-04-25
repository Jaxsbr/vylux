import { describe, expect, it } from 'vitest';
import { Hasher, hashI32Array } from './hash';

describe('Hasher (FNV-1a 64)', () => {
  it('produces the same digest for the same input', () => {
    const a = new Hasher();
    const b = new Hasher();
    for (let i = 0; i < 100; i++) {
      a.writeI32(i);
      b.writeI32(i);
    }
    expect(a.digest()).toBe(b.digest());
    expect(a.digestHex()).toBe(b.digestHex());
  });

  it('different inputs produce different digests', () => {
    const a = new Hasher();
    const b = new Hasher();
    a.writeI32(1);
    b.writeI32(2);
    expect(a.digest()).not.toBe(b.digest());
  });

  it('order matters', () => {
    const a = new Hasher();
    a.writeI32(1);
    a.writeI32(2);

    const b = new Hasher();
    b.writeI32(2);
    b.writeI32(1);

    expect(a.digest()).not.toBe(b.digest());
  });

  it('FNV-1a empty digest is the offset basis', () => {
    const h = new Hasher();
    expect(h.digest()).toBe(0xcbf29ce484222325n);
  });

  it('digestHex is 16 chars zero-padded', () => {
    const h = new Hasher();
    h.writeI32(0);
    expect(h.digestHex()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('writeI32 handles negative values', () => {
    const a = new Hasher();
    a.writeI32(-1);
    const b = new Hasher();
    b.writeI32(-1);
    expect(a.digest()).toBe(b.digest());
  });

  it('writeU64 covers full 64-bit range', () => {
    const a = new Hasher();
    a.writeU64(0xffffffffffffffffn);
    const b = new Hasher();
    b.writeU64(0xffffffffffffffffn);
    expect(a.digest()).toBe(b.digest());

    const c = new Hasher();
    c.writeU64(0xfffffffffffffffen);
    expect(a.digest()).not.toBe(c.digest());
  });

  it('writeI32Array distinguishes different-length sequences', () => {
    // Length is mixed first, so [1] and [1, 0] hash differently even though
    // both end "with a 1".
    expect(hashI32Array([1])).not.toBe(hashI32Array([1, 0]));
  });

  it('hashI32Array is a stable shorthand', () => {
    expect(hashI32Array([1, 2, 3])).toBe(hashI32Array([1, 2, 3]));
    expect(hashI32Array([1, 2, 3])).not.toBe(hashI32Array([3, 2, 1]));
  });

  it('determinism: 1000 mixed writes repeat exactly', () => {
    function build(): string {
      const h = new Hasher();
      for (let i = 0; i < 1000; i++) {
        h.writeI32(i);
        h.writeI32(-i);
        if (i % 7 === 0) h.writeU64(BigInt(i) * 0x123456789abcdefn);
      }
      return h.digestHex();
    }
    expect(build()).toBe(build());
  });
});
