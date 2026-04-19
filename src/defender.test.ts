import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildDefender, DEFENDER_SPEED } from './defender';

describe('buildDefender', () => {
  it('returns a DefenderBundle with the correct faction', () => {
    const d = buildDefender('blue', 2, 3);
    expect(d.faction).toBe('blue');
  });

  it('sets initial tileX and tileY', () => {
    const d = buildDefender('blue', 4, 7);
    expect(d.tileX).toBe(4);
    expect(d.tileY).toBe(7);
  });

  it('mesh is a Group', () => {
    const d = buildDefender('blue', 0, 0);
    expect(d.mesh).toBeInstanceOf(THREE.Group);
  });

  it('mesh contains child meshes (octagonal prism geometry)', () => {
    const d = buildDefender('blue', 0, 0);
    const meshChildren: THREE.Mesh[] = [];
    d.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshChildren.push(obj);
    });
    expect(meshChildren.length).toBeGreaterThan(0);
  });

  it('faction emissive is set for blue', () => {
    const d = buildDefender('blue', 0, 0);
    let found = false;
    d.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        if (mat.emissive && mat.emissive.getHex() === 0x00e0ff) found = true;
      }
    });
    expect(found).toBe(true);
  });

  it('faction emissive is set for red', () => {
    const d = buildDefender('red', 0, 0);
    let found = false;
    d.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        if (mat.emissive && mat.emissive.getHex() === 0xff4a1a) found = true;
      }
    });
    expect(found).toBe(true);
  });

  it('selectionRing starts invisible', () => {
    const d = buildDefender('blue', 0, 0);
    expect(d.selectionRing.visible).toBe(false);
  });

  it('DEFENDER_SPEED is approximately 1.2 tiles per second', () => {
    expect(DEFENDER_SPEED).toBeCloseTo(1.2, 5);
  });
});

describe('DefenderBundle.moveTo + tick', () => {
  it('reaches target tile after sufficient ticks', () => {
    const d = buildDefender('blue', 0, 0);
    d.moveTo(2, 0);

    // Distance = 2 tiles, speed = 1.2 t/s → ~1.67s needed. Use 3s to be safe.
    for (let i = 0; i < 90; i++) {
      d.tick(1 / 30);
    }

    expect(d.tileX).toBe(2);
    expect(d.tileY).toBe(0);
  });

  it('stops at target (idempotent ticks after arrival)', () => {
    const d = buildDefender('blue', 0, 0);
    d.moveTo(1, 0);

    for (let i = 0; i < 100; i++) {
      d.tick(0.1);
    }
    expect(d.tileX).toBe(1);
    expect(d.tileY).toBe(0);

    d.tick(1);
    expect(d.tileX).toBe(1);
    expect(d.tileY).toBe(0);
  });
});

describe('DefenderBundle.setTile', () => {
  it('teleports the defender instantly', () => {
    const d = buildDefender('blue', 0, 0);
    d.setTile(5, 8);
    expect(d.tileX).toBe(5);
    expect(d.tileY).toBe(8);
  });

  it('clamps out-of-bounds tile coordinates', () => {
    const d = buildDefender('blue', 0, 0);
    expect(() => d.setTile(-5, 25)).not.toThrow();
    expect(d.tileX).toBeGreaterThanOrEqual(0);
    expect(d.tileY).toBeLessThanOrEqual(19);
  });
});

it('buildDefender is synchronous — no async side effects', () => {
  const d = buildDefender('red', 5, 5);
  expect(d.faction).toBe('red');
});
