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
  // Two-tier grid: every cell gets a faint "minor" line; every Nth
  // cell gets a brighter "major" line. The hierarchy gives the floor
  // a sense of scale and a stronger Tron-grid read without thickening
  // every line. gridSize (32) is divisible by 8, so majors land on
  // 0/8/16/24/32 — the four edges plus the centerline-ish rhythm.
  majorDividerStep: 8,
  majorEmissiveIntensity: 1.2,
  minorEmissiveIntensity: 0.25,
  tileColor: 0x0a0a0a,
  tileY: 0,
  dividerY: 0.02,
  // Extended (out-of-play) grid: a much larger, much dimmer grid
  // rendered just below the play grid so the play area sits inside a
  // larger Tron world. Tile size matches the play grid so lines line
  // up; intensities are pulled way back so the play area still reads
  // as the foreground. A radial fade (applied via shader injection)
  // dims the lines toward zero with distance from the world origin so
  // the grid dissolves into the distance instead of cutting hard at
  // its outer edge.
  extendedGridMultiplier: 6,
  extendedMajorIntensity: 0.18,
  extendedMinorIntensity: 0.04,
  extendedDividerY: 0.015,
  extendedFadeInner: 16, // right at the play boundary (worldExtent/2)
  extendedFadeOuter: 38, // tight falloff — lines gone within ~0.7× worldExtent past the play edge
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
  majorGridLineMaterial: THREE.MeshStandardMaterial;
  minorGridLineMaterial: THREE.MeshStandardMaterial;
  extendedMajorGridLineMaterial: THREE.MeshStandardMaterial;
  extendedMinorGridLineMaterial: THREE.MeshStandardMaterial;
};

export function buildGrid(): GridBundle {
  const {
    gridSize,
    tileSize,
    worldExtent,
    dividerWidth,
    dividerEmissive,
    majorDividerStep,
    majorEmissiveIntensity,
    minorEmissiveIntensity,
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

  const majorGridLineMaterial = new THREE.MeshStandardMaterial({
    color: dividerEmissive,
    emissive: dividerEmissive,
    emissiveIntensity: majorEmissiveIntensity,
  });
  const minorGridLineMaterial = new THREE.MeshStandardMaterial({
    color: dividerEmissive,
    emissive: dividerEmissive,
    emissiveIntensity: minorEmissiveIntensity,
  });

  const dividersGroup = new THREE.Group();
  dividersGroup.name = 'grid-dividers';

  const horizontalGeometry = new THREE.PlaneGeometry(worldExtent, dividerWidth);
  const verticalGeometry = new THREE.PlaneGeometry(dividerWidth, worldExtent);
  for (let i = 0; i <= gridSize; i++) {
    const worldCoord = -worldExtent / 2 + i * tileSize;
    const material = i % majorDividerStep === 0 ? majorGridLineMaterial : minorGridLineMaterial;

    const horizontal = new THREE.Mesh(horizontalGeometry, material);
    horizontal.rotation.x = -Math.PI / 2;
    horizontal.position.set(0, dividerY, worldCoord);
    dividersGroup.add(horizontal);

    const vertical = new THREE.Mesh(verticalGeometry, material);
    vertical.rotation.x = -Math.PI / 2;
    vertical.position.set(worldCoord, dividerY, 0);
    dividersGroup.add(vertical);
  }

  // Extended (out-of-play) grid. Same line spacing so it reads as a
  // continuation of the play surface; much dimmer so the play area
  // stays foregrounded. Lines that would overlap the play grid get
  // skipped — the brighter play-grid lines own that footprint.
  const {
    extendedGridMultiplier,
    extendedMajorIntensity,
    extendedMinorIntensity,
    extendedDividerY,
  } = GRID_CONSTANTS;
  // transparent + depthWrite:false so the radial-fade shader patch can
  // dissolve these lines into whatever's behind them (sky gradient)
  // instead of fading to black, which only reads against bright pixels.
  const extendedMajorGridLineMaterial = new THREE.MeshStandardMaterial({
    color: dividerEmissive,
    emissive: dividerEmissive,
    emissiveIntensity: extendedMajorIntensity,
    transparent: true,
    depthWrite: false,
  });
  const extendedMinorGridLineMaterial = new THREE.MeshStandardMaterial({
    color: dividerEmissive,
    emissive: dividerEmissive,
    emissiveIntensity: extendedMinorIntensity,
    transparent: true,
    depthWrite: false,
  });
  applyRadialFade(extendedMajorGridLineMaterial);
  applyRadialFade(extendedMinorGridLineMaterial);

  const extendedExtent = worldExtent * extendedGridMultiplier;
  const extendedSize = gridSize * extendedGridMultiplier;
  const halfPlay = worldExtent / 2;

  const extendedGroup = new THREE.Group();
  extendedGroup.name = 'extended-grid';

  const extHorizontalGeometry = new THREE.PlaneGeometry(extendedExtent, dividerWidth);
  const extVerticalGeometry = new THREE.PlaneGeometry(dividerWidth, extendedExtent);
  for (let i = 0; i <= extendedSize; i++) {
    const worldCoord = -extendedExtent / 2 + i * tileSize;
    // Skip the strip that overlaps the play grid — play-grid lines
    // already render at that footprint, brighter.
    if (worldCoord >= -halfPlay && worldCoord <= halfPlay) continue;
    const useMajor = i % majorDividerStep === 0;
    const material = useMajor ? extendedMajorGridLineMaterial : extendedMinorGridLineMaterial;

    const horizontal = new THREE.Mesh(extHorizontalGeometry, material);
    horizontal.rotation.x = -Math.PI / 2;
    horizontal.position.set(0, extendedDividerY, worldCoord);
    extendedGroup.add(horizontal);

    const vertical = new THREE.Mesh(extVerticalGeometry, material);
    vertical.rotation.x = -Math.PI / 2;
    vertical.position.set(worldCoord, extendedDividerY, 0);
    extendedGroup.add(vertical);
  }

  group.add(tilesGroup, dividersGroup, extendedGroup);

  return {
    group,
    tileMeshes,
    tileColors,
    majorGridLineMaterial,
    minorGridLineMaterial,
    extendedMajorGridLineMaterial,
    extendedMinorGridLineMaterial,
  };
}

// Patch a material so its fragment output is multiplied by a radial
// fade based on world XZ distance from origin. Inner radius = full
// intensity; outer radius = fully invisible; smoothstep between. Used
// to dissolve the out-of-play extended grid as it stretches away from
// the play area instead of hard-cutting at the geometry edge.
function applyRadialFade(mat: THREE.MeshStandardMaterial): void {
  const uniforms = {
    uFadeInner: { value: GRID_CONSTANTS.extendedFadeInner },
    uFadeOuter: { value: GRID_CONSTANTS.extendedFadeOuter },
  };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFadeInner = uniforms.uFadeInner;
    shader.uniforms.uFadeOuter = uniforms.uFadeOuter;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec2 vWorldXZ;\nvoid main() {')
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        'varying vec2 vWorldXZ;\nuniform float uFadeInner;\nuniform float uFadeOuter;\nvoid main() {',
      )
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\nfloat d = length(vWorldXZ);\nfloat fade = 1.0 - smoothstep(uFadeInner, uFadeOuter, d);\ngl_FragColor.a *= fade;',
      );
  };
  mat.needsUpdate = true;
}
