export const GRID_CONSTANTS = {
  gridSize: 20,
  tileSize: 1,
  worldExtent: 20,
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
  const { tileSize, worldExtent } = GRID_CONSTANTS;
  const offset = -worldExtent / 2 + tileSize / 2;
  return {
    x: offset + tileX * tileSize,
    y: 0,
    z: offset + tileY * tileSize,
  };
}
