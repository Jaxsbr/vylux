import * as THREE from 'three';
import type { FactionId } from './placement';

// Width of the full HP bar in world units.
export const HP_BAR_WIDTH = 0.72;
// Height of the HP bar.
export const HP_BAR_HEIGHT = 0.09;
// Y offset above the unit mesh top (applied to the group holding the bar).
export const HP_BAR_Y = 1.1;

// Faction fill colour for the HP bar — bright neon for contrast.
const FACTION_COLOR: Record<FactionId, number> = {
  blue: 0x00ffff,
  red: 0xff3300,
};
// High-contrast backing pill (near-black with slight transparency so units still read through).
const BG_COLOR = 0x000000;
// White border/pill behind the bg to make the bar pop on any tile or unit background.
const PILL_COLOR = 0xffffff;
// Padding around the bar for the contrast pill.
const PILL_PAD = 0.025;

export type HpBar = {
  group: THREE.Group;
  fillMesh: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  update: (hp: number, maxHp: number) => void;
};

export function buildHpBar(faction: FactionId, yOffset: number): HpBar {
  const group = new THREE.Group();
  group.name = 'hp-bar';

  // White contrast pill — rendered behind the dark background to make the bar
  // visible over any tile colour or unit body.
  const pillGeo = new THREE.PlaneGeometry(HP_BAR_WIDTH + PILL_PAD * 2, HP_BAR_HEIGHT + PILL_PAD * 2);
  const pillMat = new THREE.MeshBasicMaterial({ color: PILL_COLOR, depthTest: false });
  const pillMesh = new THREE.Mesh(pillGeo, pillMat);
  pillMesh.name = 'hp-bar-pill';
  pillMesh.renderOrder = 997;
  pillMesh.position.z = -0.002;
  group.add(pillMesh);

  // Dark background inside the pill.
  const bgGeo = new THREE.PlaneGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT);
  const bgMat = new THREE.MeshBasicMaterial({ color: BG_COLOR, depthTest: false });
  const bgMesh = new THREE.Mesh(bgGeo, bgMat);
  bgMesh.name = 'hp-bar-bg';
  bgMesh.renderOrder = 998;
  bgMesh.position.z = -0.001;
  group.add(bgMesh);

  // Faction-coloured fill bar — starts at full width, anchored left.
  const fillGeo = new THREE.PlaneGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT);
  const fillMat = new THREE.MeshBasicMaterial({ color: FACTION_COLOR[faction], depthTest: false });
  const fillMesh = new THREE.Mesh(fillGeo, fillMat);
  fillMesh.name = 'hp-bar-fill';
  fillMesh.renderOrder = 999;
  group.add(fillMesh);

  group.position.y = yOffset;

  const update = (hp: number, maxHp: number): void => {
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
    // Scale fill on X axis; pivot is at centre, so also shift X.
    fillMesh.scale.x = ratio;
    fillMesh.position.x = (ratio - 1) * (HP_BAR_WIDTH / 2);
  };

  return { group, fillMesh, fillMat, update };
}
