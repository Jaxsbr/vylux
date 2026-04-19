import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildRaider, RAIDER_SPEED } from './raider';

describe('buildRaider', () => {
  it('returns a RaiderBundle with the correct faction', () => {
    const r = buildRaider('blue', 3, 3);
    expect(r.faction).toBe('blue');
  });

  it('sets initial tileX and tileY', () => {
    const r = buildRaider('blue', 6, 2);
    expect(r.tileX).toBe(6);
    expect(r.tileY).toBe(2);
  });

  it('mesh is a Group', () => {
    const r = buildRaider('blue', 0, 0);
    expect(r.mesh).toBeInstanceOf(THREE.Group);
  });

  it('mesh contains child meshes (blade/wedge geometry)', () => {
    const r = buildRaider('blue', 0, 0);
    const meshChildren: THREE.Mesh[] = [];
    r.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshChildren.push(obj);
    });
    expect(meshChildren.length).toBeGreaterThan(0);
  });

  it('faction emissive is set for blue', () => {
    const r = buildRaider('blue', 0, 0);
    let found = false;
    r.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        if (mat.emissive && mat.emissive.getHex() === 0x00e0ff) found = true;
      }
    });
    expect(found).toBe(true);
  });

  it('faction emissive is set for red', () => {
    const r = buildRaider('red', 0, 0);
    let found = false;
    r.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        if (mat.emissive && mat.emissive.getHex() === 0xff4a1a) found = true;
      }
    });
    expect(found).toBe(true);
  });

  it('selectionRing starts invisible', () => {
    const r = buildRaider('blue', 0, 0);
    expect(r.selectionRing.visible).toBe(false);
  });

  it('RAIDER_SPEED is approximately 2.8 tiles per second', () => {
    expect(RAIDER_SPEED).toBeCloseTo(2.8, 5);
  });
});

describe('RaiderBundle.moveTo + tick', () => {
  it('reaches target tile faster than a worker (high speed)', () => {
    const r = buildRaider('blue', 0, 0);
    r.moveTo(3, 0);

    // Distance = 3 tiles, speed = 2.8 t/s → ~1.07s. Use 2s ticks.
    for (let i = 0; i < 60; i++) {
      r.tick(1 / 30);
    }

    expect(r.tileX).toBe(3);
    expect(r.tileY).toBe(0);
  });

  it('stops at target (idempotent ticks after arrival)', () => {
    const r = buildRaider('blue', 0, 0);
    r.moveTo(1, 1);

    for (let i = 0; i < 100; i++) {
      r.tick(0.1);
    }
    expect(r.tileX).toBe(1);
    expect(r.tileY).toBe(1);

    r.tick(1);
    expect(r.tileX).toBe(1);
    expect(r.tileY).toBe(1);
  });
});

describe('RaiderBundle.setTile', () => {
  it('teleports the raider instantly', () => {
    const r = buildRaider('blue', 0, 0);
    r.setTile(7, 9);
    expect(r.tileX).toBe(7);
    expect(r.tileY).toBe(9);
  });

  it('clamps out-of-bounds tile coordinates', () => {
    const r = buildRaider('blue', 0, 0);
    expect(() => r.setTile(-2, 22)).not.toThrow();
    expect(r.tileX).toBeGreaterThanOrEqual(0);
    expect(r.tileY).toBeLessThanOrEqual(19);
  });
});

it('buildRaider is synchronous — no async side effects', () => {
  const r = buildRaider('red', 2, 2);
  expect(r.faction).toBe('red');
});
