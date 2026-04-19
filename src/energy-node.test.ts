import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildEnergyNode, NODE_POSITIONS } from './energy-node';

describe('buildEnergyNode', () => {
  it('returns a group containing body and rim meshes', () => {
    const node = buildEnergyNode(5, 5);
    expect(node.group).toBeInstanceOf(THREE.Group);
    const body = node.group.children.find((c) => c.name === 'node-body');
    const rim = node.group.children.find((c) => c.name === 'node-rim');
    expect(body).toBeDefined();
    expect(rim).toBeDefined();
  });

  it('rim default colour is pale-cyan #9ceaf4', () => {
    const node = buildEnergyNode(5, 5);
    const rim = node.group.children.find((c) => c.name === 'node-rim') as THREE.Mesh;
    const mat = rim.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('9ceaf4');
    expect(mat.emissive.getHexString()).toBe('9ceaf4');
  });

  it('rim emissive intensity is >= 0.8', () => {
    const node = buildEnergyNode(5, 5);
    const rim = node.group.children.find((c) => c.name === 'node-rim') as THREE.Mesh;
    const mat = rim.material as THREE.MeshStandardMaterial;
    expect(mat.emissiveIntensity).toBeGreaterThanOrEqual(0.8);
  });

  it('node body sits at Y=0.04 (flush with grid)', () => {
    const node = buildEnergyNode(5, 5);
    const body = node.group.children.find((c) => c.name === 'node-body') as THREE.Mesh;
    expect(body.position.y).toBeCloseTo(0.04);
  });

  it('stores tileX and tileY', () => {
    const node = buildEnergyNode(7, 12);
    expect(node.tileX).toBe(7);
    expect(node.tileY).toBe(12);
  });
});

describe('setFactionHold', () => {
  it('blue hold shifts rim to cyan #00e0ff', () => {
    const node = buildEnergyNode(5, 5);
    node.setFactionHold('blue');
    const rim = node.group.children.find((c) => c.name === 'node-rim') as THREE.Mesh;
    const mat = rim.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('00e0ff');
    expect(mat.emissive.getHexString()).toBe('00e0ff');
  });

  it('red hold shifts rim to red-orange #ff4a1a', () => {
    const node = buildEnergyNode(5, 5);
    node.setFactionHold('red');
    const rim = node.group.children.find((c) => c.name === 'node-rim') as THREE.Mesh;
    const mat = rim.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('ff4a1a');
    expect(mat.emissive.getHexString()).toBe('ff4a1a');
  });

  it('null resets rim to neutral pale-cyan #9ceaf4', () => {
    const node = buildEnergyNode(5, 5);
    node.setFactionHold('red');
    node.setFactionHold(null);
    const rim = node.group.children.find((c) => c.name === 'node-rim') as THREE.Mesh;
    const mat = rim.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('9ceaf4');
    expect(mat.emissive.getHexString()).toBe('9ceaf4');
  });

  it('multiple calls to setFactionHold stay consistent', () => {
    const node = buildEnergyNode(14, 14);
    node.setFactionHold('blue');
    node.setFactionHold('red');
    node.setFactionHold('blue');
    const rim = node.group.children.find((c) => c.name === 'node-rim') as THREE.Mesh;
    const mat = rim.material as THREE.MeshStandardMaterial;
    expect(mat.color.getHexString()).toBe('00e0ff');
  });
});

describe('NODE_POSITIONS', () => {
  it('has exactly 4 positions', () => {
    expect(NODE_POSITIONS).toHaveLength(4);
  });

  it('all positions are valid in-bounds tile coords', () => {
    for (const [tx, ty] of NODE_POSITIONS) {
      expect(tx).toBeGreaterThanOrEqual(0);
      expect(tx).toBeLessThan(20);
      expect(ty).toBeGreaterThanOrEqual(0);
      expect(ty).toBeLessThan(20);
    }
  });
});
