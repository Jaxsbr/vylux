// Per-entity mesh builders for the sim-driven renderer.
//
// Minimal Tron-style geometry: faction-colored emissive boxes/cylinders
// on the charcoal grid. These are deliberately simpler than the
// prototype's mesh builders because the sim doesn't carry the prototype's
// per-entity render state (selection rings, pulse animations, HP-bar
// tweens). Phase 1.5+ can layer those back on if the design calls for
// them.

import * as THREE from 'three';
import type { Faction, UnitKind } from '../sim/types';

export const FACTION_COLOR: Record<Faction, number> = {
  0: 0x00e5ff, // cyan-ish
  1: 0xff6a33, // red-orange
};

const NODE_COLOR = 0xfff5b3; // pale neon gold

// HQ — chunky cube with bright edge glow.
export function buildHqMesh(faction: Faction): THREE.Group {
  const group = new THREE.Group();
  const colour = FACTION_COLOR[faction];
  const size = 1.4;

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(size, size, size),
    new THREE.MeshStandardMaterial({
      color: 0x111417,
      emissive: colour,
      emissiveIntensity: 0.25,
    }),
  );
  body.position.y = size / 2;
  group.add(body);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({ color: colour }),
  );
  edges.position.copy(body.position);
  group.add(edges);

  return group;
}

// Worker — short upright cylinder.
export function buildUnitMesh(kind: UnitKind, faction: Faction): THREE.Group {
  const group = new THREE.Group();
  const colour = FACTION_COLOR[faction];

  switch (kind) {
    case 'worker': {
      const geo = new THREE.CylinderGeometry(0.18, 0.18, 0.45, 12);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: 0x111417,
          emissive: colour,
          emissiveIntensity: 0.55,
        }),
      );
      mesh.position.y = 0.225;
      group.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: colour }),
      );
      edges.position.copy(mesh.position);
      group.add(edges);
      return group;
    }
    case 'defender': {
      const geo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({
          color: 0x111417,
          emissive: colour,
          emissiveIntensity: 0.55,
        }),
      );
      mesh.position.y = 0.275;
      group.add(mesh);
      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: colour }),
      );
      edges.position.copy(mesh.position);
      group.add(edges);
      return group;
    }
    case 'raider': {
      // Faceted cone-on-base, gives an aggressive / fast read.
      const baseGeo = new THREE.CylinderGeometry(0.18, 0.25, 0.18, 6);
      const tipGeo = new THREE.ConeGeometry(0.18, 0.45, 6);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x111417,
        emissive: colour,
        emissiveIntensity: 0.65,
      });
      const base = new THREE.Mesh(baseGeo, mat);
      base.position.y = 0.09;
      const tip = new THREE.Mesh(tipGeo, mat);
      tip.position.y = 0.18 + 0.225;
      group.add(base, tip);
      const edges1 = new THREE.LineSegments(
        new THREE.EdgesGeometry(baseGeo),
        new THREE.LineBasicMaterial({ color: colour }),
      );
      edges1.position.copy(base.position);
      const edges2 = new THREE.LineSegments(
        new THREE.EdgesGeometry(tipGeo),
        new THREE.LineBasicMaterial({ color: colour }),
      );
      edges2.position.copy(tip.position);
      group.add(edges1, edges2);
      return group;
    }
  }
}

// Selection ring — sits flush on the grid under a selected unit.
export function buildSelectionRing(): THREE.Mesh {
  const geo = new THREE.RingGeometry(0.4, 0.5, 24);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1.2,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
  });
  const m = new THREE.Mesh(geo, mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.04;
  return m;
}

// HP bar — thin emissive strip floating above the unit. Scale x by hp/max.
export interface HpBarBundle {
  group: THREE.Group;
  fill: THREE.Mesh;
  fillMat: THREE.MeshStandardMaterial;
  background: THREE.Mesh;
}

export function buildHpBar(faction: Faction): HpBarBundle {
  const group = new THREE.Group();
  const colour = FACTION_COLOR[faction];

  const bgGeo = new THREE.PlaneGeometry(0.6, 0.08);
  const bgMat = new THREE.MeshBasicMaterial({
    color: 0x111417,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
  });
  const background = new THREE.Mesh(bgGeo, bgMat);
  background.rotation.x = -Math.PI / 2;
  group.add(background);

  const fillGeo = new THREE.PlaneGeometry(0.58, 0.06);
  const fillMat = new THREE.MeshStandardMaterial({
    color: 0x111417,
    emissive: colour,
    emissiveIntensity: 0.9,
    side: THREE.DoubleSide,
  });
  const fill = new THREE.Mesh(fillGeo, fillMat);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.001; // sit above background to avoid z-fighting
  group.add(fill);

  return { group, fill, fillMat, background };
}

// Energy node — squat glowing cylinder.
export function buildNodeMesh(): THREE.Group {
  const group = new THREE.Group();
  const geo = new THREE.CylinderGeometry(0.32, 0.32, 0.35, 16);
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      color: 0x222019,
      emissive: NODE_COLOR,
      emissiveIntensity: 0.5,
    }),
  );
  mesh.position.y = 0.175;
  group.add(mesh);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: NODE_COLOR }),
  );
  edges.position.copy(mesh.position);
  group.add(edges);
  return group;
}
