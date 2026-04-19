import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildWorker, WORKER_SPEED } from './worker';

describe('buildWorker', () => {
  it('returns a WorkerBundle with the correct faction', () => {
    const w = buildWorker('blue', 1, 0);
    expect(w.faction).toBe('blue');
  });

  it('sets initial tileX and tileY', () => {
    const w = buildWorker('blue', 3, 7);
    expect(w.tileX).toBe(3);
    expect(w.tileY).toBe(7);
  });

  it('mesh is a Group (not a plain Box)', () => {
    const w = buildWorker('blue', 0, 0);
    expect(w.mesh).toBeInstanceOf(THREE.Group);
  });

  it('mesh contains child meshes (diamond prism geometry)', () => {
    const w = buildWorker('blue', 0, 0);
    const meshChildren: THREE.Mesh[] = [];
    w.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) meshChildren.push(obj);
    });
    expect(meshChildren.length).toBeGreaterThan(0);
  });

  it('faction emissive is set for blue', () => {
    const w = buildWorker('blue', 0, 0);
    let found = false;
    w.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        if (mat.emissive && mat.emissive.getHex() === 0x00e0ff) found = true;
      }
    });
    expect(found).toBe(true);
  });

  it('faction emissive is set for red', () => {
    const w = buildWorker('red', 0, 0);
    let found = false;
    w.mesh.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        if (mat.emissive && mat.emissive.getHex() === 0xff4a1a) found = true;
      }
    });
    expect(found).toBe(true);
  });

  it('selectionRing starts invisible', () => {
    const w = buildWorker('blue', 0, 0);
    expect(w.selectionRing.visible).toBe(false);
  });
});

describe('WorkerBundle.moveTo + tick', () => {
  it('reaches target tile after sufficient ticks', () => {
    const w = buildWorker('blue', 0, 0);
    w.moveTo(4, 3);

    // Simulate enough time: distance = sqrt(16+9) = 5 tiles, speed = 2 t/s → 2.5s
    const totalTime = 3; // seconds
    const steps = 60;
    const dt = totalTime / steps;
    for (let i = 0; i < steps; i++) {
      w.tick(dt);
    }

    expect(w.tileX).toBe(4);
    expect(w.tileY).toBe(3);
  });

  it('stops at target (idempotent ticks after arrival)', () => {
    const w = buildWorker('blue', 0, 0);
    w.moveTo(1, 0);

    // Move enough to arrive.
    for (let i = 0; i < 100; i++) {
      w.tick(0.05);
    }
    expect(w.tileX).toBe(1);
    expect(w.tileY).toBe(0);

    // Additional ticks should not change position.
    w.tick(1);
    expect(w.tileX).toBe(1);
    expect(w.tileY).toBe(0);
  });

  it('WORKER_SPEED is 2 tiles per second', () => {
    expect(WORKER_SPEED).toBe(2);
  });

  it('changes direction mid-move if moveTo is called again', () => {
    const w = buildWorker('blue', 0, 0);
    w.moveTo(10, 0); // heading east

    // Advance partway.
    w.tick(1); // moved ~2 tiles east

    // Redirect south.
    w.moveTo(0, 10);

    // Tick enough to reach the new target from wherever we are.
    for (let i = 0; i < 200; i++) {
      w.tick(0.1);
    }

    expect(w.tileX).toBe(0);
    expect(w.tileY).toBe(10);
  });
});

describe('WorkerBundle.setTile', () => {
  it('teleports the worker instantly', () => {
    const w = buildWorker('blue', 0, 0);
    w.setTile(5, 8);
    expect(w.tileX).toBe(5);
    expect(w.tileY).toBe(8);
  });

  it('cancels ongoing movement', () => {
    const w = buildWorker('blue', 0, 0);
    w.moveTo(10, 10);
    w.tick(0.1); // start moving
    w.setTile(2, 2); // teleport
    // Additional tick should not move toward (10,10).
    w.tick(0.5);
    expect(w.tileX).toBe(2);
    expect(w.tileY).toBe(2);
  });

  it('clamps out-of-bounds tile coordinates', () => {
    const w = buildWorker('blue', 0, 0);
    // setTile should clamp without throwing.
    expect(() => w.setTile(-5, 25)).not.toThrow();
    expect(w.tileX).toBeGreaterThanOrEqual(0);
    expect(w.tileY).toBeLessThanOrEqual(19);
  });
});

// Guard: buildWorker is synchronous and does not call any async APIs.
it('buildWorker is synchronous — no async side effects', () => {
  // If buildWorker were async or called setTimeout/RAF it would throw in this env.
  const w = buildWorker('red', 5, 5);
  expect(w.faction).toBe('red');
});
