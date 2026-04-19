import * as THREE from 'three';
import type { FactionId } from './placement';

// Width of the full HP bar in world units.
export const HP_BAR_WIDTH = 0.7;
// Height of the HP bar.
export const HP_BAR_HEIGHT = 0.07;
// Y offset above the unit mesh top (applied to the group holding the bar).
export const HP_BAR_Y = 1.1;

// Faction fill colour for the HP bar.
const FACTION_COLOR: Record<FactionId, number> = {
  blue: 0x00e0ff,
  red: 0xff4a1a,
};
const BG_COLOR = 0x1a1a1a;

export type HpBar = {
  group: THREE.Group;
  fillMesh: THREE.Mesh;
  fillMat: THREE.MeshBasicMaterial;
  update: (hp: number, maxHp: number) => void;
};

export function buildHpBar(faction: FactionId, yOffset: number): HpBar {
  const group = new THREE.Group();
  group.name = 'hp-bar';

  // Background (dark fill).
  const bgGeo = new THREE.PlaneGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT);
  const bgMat = new THREE.MeshBasicMaterial({ color: BG_COLOR, depthTest: false, transparent: true });
  const bgMesh = new THREE.Mesh(bgGeo, bgMat);
  bgMesh.name = 'hp-bar-bg';
  bgMesh.renderOrder = 999;
  group.add(bgMesh);

  // Faction-coloured fill bar — starts at full width, anchored left.
  const fillGeo = new THREE.PlaneGeometry(HP_BAR_WIDTH, HP_BAR_HEIGHT);
  const fillMat = new THREE.MeshBasicMaterial({ color: FACTION_COLOR[faction], depthTest: false });
  const fillMesh = new THREE.Mesh(fillGeo, fillMat);
  fillMesh.name = 'hp-bar-fill';
  fillMesh.renderOrder = 1000;
  // Shift slightly above bg to avoid z-fighting.
  fillMesh.position.z = 0.001;
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
