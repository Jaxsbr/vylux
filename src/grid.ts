import * as THREE from 'three';

// Phase 3.4 bumped gridSize from 20 to 32. The map is bigger to make
// room for the catalog still landing in 3.5+ (faction-locked colour
// nodes, Pylons, more contested zones). worldExtent is derived from
// gridSize * tileSize so the divider math + tile-to-world projection
// stay consistent if the constant moves again.
const GRID_SIZE = 32;
const TILE_SIZE = 1;

export const GRID_CONSTANTS = {
  gridSize: GRID_SIZE,
  tileSize: TILE_SIZE,
  worldExtent: GRID_SIZE * TILE_SIZE,
  dividerWidth: 0.02,
  // Phase 3.9.4: bumped from 0.4 → 1.2 so the grid reads as actual
  // neon under good lighting. The fog overlay paints a dark layer
  // *over* this bright grid in unexplored regions; without a bright
  // base there is nothing for the fog to obscure (the v1 fog failed
  // here — the grid was already near-black, and adding more darkness
  // had no visible effect).
  dividerEmissive: 0x555555,
  dividerEmissiveIntensity: 1.2,
  tileColor: 0x0a0a0a,
  tileY: 0,
  dividerY: 0.02,
} as const;

export const TILE_COUNT = GRID_CONSTANTS.gridSize * GRID_CONSTANTS.gridSize;

export type TileCoord = { tileX: number; tileY: number };
export type WorldPosition = { x: number; y: number; z: number };

function assertInBounds(tileX: number, tileY: number): void {
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) {
    throw new Error(
      `tileToWorld: tile coordinates must be integers (got tileX=${tileX}, tileY=${tileY})`,
    );
  }
  const { gridSize } = GRID_CONSTANTS;
  if (tileX < 0 || tileX >= gridSize || tileY < 0 || tileY >= gridSize) {
    throw new Error(
      `tileToWorld: tile coordinates out of range 0..${gridSize - 1} (got tileX=${tileX}, tileY=${tileY})`,
    );
  }
}

export function tileToWorld(tileX: number, tileY: number): WorldPosition {
  assertInBounds(tileX, tileY);
  const { tileSize, worldExtent, tileY: y } = GRID_CONSTANTS;
  const offset = -worldExtent / 2 + tileSize / 2;
  return {
    x: offset + tileX * tileSize,
    y,
    z: offset + tileY * tileSize,
  };
}

export type GridBundle = {
  group: THREE.Group;
  tileMeshes: THREE.Mesh[];
  tileColors: string[];
  gridLineMaterial: THREE.MeshStandardMaterial;
};

export function buildGrid(): GridBundle {
  const {
    gridSize,
    tileSize,
    worldExtent,
    dividerWidth,
    dividerEmissive,
    dividerEmissiveIntensity,
    tileColor,
    tileY,
    dividerY,
  } = GRID_CONSTANTS;

  const group = new THREE.Group();
  group.name = 'grid';

  const tileGeometry = new THREE.PlaneGeometry(tileSize, tileSize);
  const tileMeshes: THREE.Mesh[] = [];
  const tileColors: string[] = [];
  const tilesGroup = new THREE.Group();
  tilesGroup.name = 'grid-tiles';

  // Grid tile plane sits a hair below the entity baseline so structure
  // bottom edges (which sit at Y=0 in world space) don't z-fight with
  // the tile mesh. Without this offset the bottom outlines on short
  // structures (work pod, pylon) drop through the floor.
  const TILE_MESH_Y = tileY - 0.01;
  for (let tY = 0; tY < gridSize; tY++) {
    for (let tX = 0; tX < gridSize; tX++) {
      const material = new THREE.MeshStandardMaterial({ color: tileColor });
      const mesh = new THREE.Mesh(tileGeometry, material);
      mesh.rotation.x = -Math.PI / 2;
      const { x, z } = tileToWorld(tX, tY);
      mesh.position.set(x, TILE_MESH_Y, z);
      mesh.userData = { tileX: tX, tileY: tY };
      tilesGroup.add(mesh);
      tileMeshes.push(mesh);
      tileColors.push('#' + material.color.getHexString());
    }
  }

  const gridLineMaterial = new THREE.MeshStandardMaterial({
    color: dividerEmissive,
    emissive: dividerEmissive,
    emissiveIntensity: dividerEmissiveIntensity,
  });

  const dividersGroup = new THREE.Group();
  dividersGroup.name = 'grid-dividers';

  const horizontalGeometry = new THREE.PlaneGeometry(worldExtent, dividerWidth);
  const verticalGeometry = new THREE.PlaneGeometry(dividerWidth, worldExtent);
  for (let i = 0; i <= gridSize; i++) {
    const worldCoord = -worldExtent / 2 + i * tileSize;

    const horizontal = new THREE.Mesh(horizontalGeometry, gridLineMaterial);
    horizontal.rotation.x = -Math.PI / 2;
    horizontal.position.set(0, dividerY, worldCoord);
    dividersGroup.add(horizontal);

    const vertical = new THREE.Mesh(verticalGeometry, gridLineMaterial);
    vertical.rotation.x = -Math.PI / 2;
    vertical.position.set(worldCoord, dividerY, 0);
    dividersGroup.add(vertical);
  }

  group.add(tilesGroup, dividersGroup);

  return { group, tileMeshes, tileColors, gridLineMaterial };
}
