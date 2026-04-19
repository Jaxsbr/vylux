import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildHQ } from './hq';

describe('buildHQ', () => {
  it('returns a group named hq-blue for the blue faction', () => {
    const hq = buildHQ('blue', 0, 0);
    expect(hq.group.name).toBe('hq-blue');
    expect(hq.faction).toBe('blue');
    expect(hq.tileX).toBe(0);
    expect(hq.tileY).toBe(0);
  });

  it('returns a group named hq-red for the red faction', () => {
    const hq = buildHQ('red', 19, 19);
    expect(hq.group.name).toBe('hq-red');
    expect(hq.faction).toBe('red');
    expect(hq.tileX).toBe(19);
    expect(hq.tileY).toBe(19);
  });

  it('group contains at least 4 child groups (base, mid, spire, antenna)', () => {
    const hq = buildHQ('blue', 0, 0);
    expect(hq.group.children.length).toBeGreaterThanOrEqual(4);
  });

  it('every tier child group contains a Mesh and a LineSegments', () => {
    const hq = buildHQ('red', 19, 19);
    for (const child of hq.group.children) {
      const tier = child as THREE.Group;
      const hasMesh = tier.children.some((c) => c instanceof THREE.Mesh);
      const hasEdges = tier.children.some((c) => c instanceof THREE.LineSegments);
      expect(hasMesh).toBe(true);
      expect(hasEdges).toBe(true);
    }
  });

  it('blue HQ tier meshes have emissive colour close to #00e0ff', () => {
    const hq = buildHQ('blue', 0, 0);
    for (const child of hq.group.children) {
      const tier = child as THREE.Group;
      const mesh = tier.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      // emissive.r ~ 0, emissive.g ~ 0.878, emissive.b ~ 1.0
      expect(mat.emissive.r).toBeCloseTo(0, 1);
      expect(mat.emissive.b).toBeGreaterThan(0.9);
    }
  });

  it('red HQ tier meshes have emissive colour close to #ff4a1a', () => {
    const hq = buildHQ('red', 19, 19);
    for (const child of hq.group.children) {
      const tier = child as THREE.Group;
      const mesh = tier.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat.emissive.r).toBeGreaterThan(0.9);
      expect(mat.emissive.b).toBeLessThan(0.2);
    }
  });

  it('emissive intensity is >= 1.0 so bloom can pick it up', () => {
    const hq = buildHQ('blue', 0, 0);
    for (const child of hq.group.children) {
      const tier = child as THREE.Group;
      const mesh = tier.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      expect(mat.emissiveIntensity).toBeGreaterThanOrEqual(1.0);
    }
  });

  it('group world position matches tileToWorld(0, 0) for tile (0, 0)', () => {
    const hq = buildHQ('blue', 0, 0);
    // tileToWorld(0,0) = (-9.5, 0, -9.5)
    expect(hq.group.position.x).toBeCloseTo(-9.5);
    expect(hq.group.position.z).toBeCloseTo(-9.5);
  });

  it('group world position matches tileToWorld(19, 19) for tile (19, 19)', () => {
    const hq = buildHQ('red', 19, 19);
    // tileToWorld(19,19) = (9.5, 0, 9.5)
    expect(hq.group.position.x).toBeCloseTo(9.5);
    expect(hq.group.position.z).toBeCloseTo(9.5);
  });
});
