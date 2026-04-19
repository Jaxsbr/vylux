export type FactionId = 'blue' | 'red';
export type PlacementMode = 'idle' | 'placement';

export type TileRef = { tileX: number; tileY: number };
export type PlacedUnit = { tileX: number; tileY: number; type: FactionId };

export type PlacementState = {
  mode: PlacementMode;
  selectedUnitType: FactionId | null;
  hoveredTile: TileRef | null;
  placedUnits: PlacedUnit[];
};

export const INITIAL_STATE: PlacementState = {
  mode: 'idle',
  selectedUnitType: null,
  hoveredTile: null,
  placedUnits: [],
};

export function handleKey(state: PlacementState, key: string): PlacementState {
  if (key === '1') {
    if (state.mode === 'placement' && state.selectedUnitType === 'blue') {
      return state;
    }
    return { ...state, mode: 'placement', selectedUnitType: 'blue' };
  }
  if (key === '2') {
    if (state.mode === 'placement' && state.selectedUnitType === 'red') {
      return state;
    }
    return { ...state, mode: 'placement', selectedUnitType: 'red' };
  }
  if (key === 'Escape') {
    if (state.mode === 'idle' && state.selectedUnitType === null) {
      return state;
    }
    return { ...state, mode: 'idle', selectedUnitType: null };
  }
  return state;
}

export function handlePointerMove(
  state: PlacementState,
  hit: TileRef | null,
): PlacementState {
  const current = state.hoveredTile;
  if (hit === null) {
    if (current === null) return state;
    return { ...state, hoveredTile: null };
  }
  if (current !== null && current.tileX === hit.tileX && current.tileY === hit.tileY) {
    return state;
  }
  return { ...state, hoveredTile: { tileX: hit.tileX, tileY: hit.tileY } };
}

const HOVER_COLORS: Record<FactionId, string> = {
  blue: '#0d4d57',
  red: '#5a2311',
};

const GHOST_EMISSIVE: Record<FactionId, string> = {
  blue: '#00e5ff',
  red: '#ff5a1f',
};

export function hoverColorFor(faction: FactionId): string {
  return HOVER_COLORS[faction];
}

export function ghostEmissiveFor(faction: FactionId): string {
  return GHOST_EMISSIVE[faction];
}

export function isTileOccupied(
  state: PlacementState,
  tileX: number,
  tileY: number,
): boolean {
  for (const unit of state.placedUnits) {
    if (unit.tileX === tileX && unit.tileY === tileY) return true;
  }
  return false;
}

export type GhostView =
  | { visible: false }
  | { visible: true; tileX: number; tileY: number; emissiveHex: string };

export type HoverView =
  | { highlight: false }
  | { highlight: true; tileX: number; tileY: number; colorHex: string };

export function computeGhostView(state: PlacementState): GhostView {
  if (
    state.mode !== 'placement' ||
    state.hoveredTile === null ||
    state.selectedUnitType === null
  ) {
    return { visible: false };
  }
  const { tileX, tileY } = state.hoveredTile;
  if (isTileOccupied(state, tileX, tileY)) {
    return { visible: false };
  }
  return {
    visible: true,
    tileX,
    tileY,
    emissiveHex: ghostEmissiveFor(state.selectedUnitType),
  };
}

export const GRID_SIZE = 20;

/** Radius of the proximity zone around the HQ (7×7 = radius 3). */
export const PROXIMITY_RADIUS = 3;

/**
 * Returns all tiles in the proximity zone around (hqX, hqY), excluding the HQ
 * tile itself. Clamps to grid bounds [0, GRID_SIZE).
 */
export function proximityZoneTiles(
  hqX: number,
  hqY: number,
): Array<{ tileX: number; tileY: number }> {
  const tiles: Array<{ tileX: number; tileY: number }> = [];
  for (let dy = -PROXIMITY_RADIUS; dy <= PROXIMITY_RADIUS; dy++) {
    for (let dx = -PROXIMITY_RADIUS; dx <= PROXIMITY_RADIUS; dx++) {
      if (dx === 0 && dy === 0) continue; // exclude HQ tile
      const tx = hqX + dx;
      const ty = hqY + dy;
      if (tx < 0 || tx >= GRID_SIZE || ty < 0 || ty >= GRID_SIZE) continue;
      tiles.push({ tileX: tx, tileY: ty });
    }
  }
  return tiles;
}

/**
 * Returns true if (tileX, tileY) is within the proximity zone around (hqX, hqY),
 * i.e., within PROXIMITY_RADIUS tiles in each axis, but not the HQ tile itself.
 */
export function isInProximityZone(
  tileX: number,
  tileY: number,
  hqX: number,
  hqY: number,
): boolean {
  if (tileX === hqX && tileY === hqY) return false;
  const dx = Math.abs(tileX - hqX);
  const dy = Math.abs(tileY - hqY);
  return dx <= PROXIMITY_RADIUS && dy <= PROXIMITY_RADIUS;
}

// ── Spawn-tile helpers ────────────────────────────────────────────────────────

/**
 * Default spawn tile for an HQ: one tile toward the map centre from the HQ.
 * Blue HQ (left side) → one tile right; Red HQ (right side) → one tile left.
 */
export function defaultSpawnTile(
  hqX: number,
  hqY: number,
  faction: FactionId,
): { x: number; y: number } {
  if (faction === 'blue') {
    return { x: hqX + 1, y: hqY };
  }
  return { x: hqX - 1, y: hqY };
}

/**
 * Returns true if a tile is a valid spawn-point relocation target for an HQ:
 *   - inside the proximity zone (not the HQ tile, within PROXIMITY_RADIUS)
 *   - not occupied by a unit or node
 * The `isOccupied` callback should return true for unit tiles and node tiles
 * (but NOT the HQ tile itself, since the proximity zone already excludes that).
 */
export function validateSpawnTile(
  tileX: number,
  tileY: number,
  hqX: number,
  hqY: number,
  isOccupied: (tx: number, ty: number) => boolean,
): boolean {
  if (!isInProximityZone(tileX, tileY, hqX, hqY)) return false;
  if (isOccupied(tileX, tileY)) return false;
  return true;
}

/**
 * Returns a new spawn tile coordinate if the relocation is valid, or null.
 * Pure transition — no side effects.
 */
export function relocateSpawnTile(
  tileX: number,
  tileY: number,
  hqX: number,
  hqY: number,
  isOccupied: (tx: number, ty: number) => boolean,
): { x: number; y: number } | null {
  if (!validateSpawnTile(tileX, tileY, hqX, hqY, isOccupied)) return null;
  return { x: tileX, y: tileY };
}

export type TryPlaceReason = 'occupied' | 'out-of-bounds' | 'not-in-placement' | 'out-of-zone';

export type TryPlaceResult =
  | { ok: true; state: PlacementState }
  | { ok: false; reason: TryPlaceReason; state: PlacementState };

export function tryPlace(
  state: PlacementState,
  tileX: number,
  tileY: number,
): TryPlaceResult {
  if (state.mode !== 'placement' || state.selectedUnitType === null) {
    return { ok: false, reason: 'not-in-placement', state };
  }
  if (!Number.isInteger(tileX) || !Number.isInteger(tileY)) {
    return { ok: false, reason: 'out-of-bounds', state };
  }
  if (tileX < 0 || tileX >= GRID_SIZE || tileY < 0 || tileY >= GRID_SIZE) {
    return { ok: false, reason: 'out-of-bounds', state };
  }
  if (isTileOccupied(state, tileX, tileY)) {
    return { ok: false, reason: 'occupied', state };
  }
  const next: PlacementState = {
    mode: 'idle',
    selectedUnitType: null,
    hoveredTile: state.hoveredTile,
    placedUnits: [...state.placedUnits, { tileX, tileY, type: state.selectedUnitType }],
  };
  return { ok: true, state: next };
}

export function handleClick(
  state: PlacementState,
  hit: TileRef | null,
  button: number,
): PlacementState {
  if (button !== 0) return state;
  if (state.mode !== 'placement' || state.selectedUnitType === null) return state;
  // Asymmetric on purpose: null hit means the pointer is off-canvas / past the
  // raycastable band (commit-or-cancel UX — exit to idle), while an out-of-bounds
  // coord from a valid raycast is treated as a rejected placement (stay in mode).
  // Today tryPlace never receives out-of-bounds from raycastPointer, but keep the
  // branches explicit so future raycast changes can't silently change UX.
  if (hit === null) {
    return { ...state, mode: 'idle', selectedUnitType: null };
  }
  const result = tryPlace(state, hit.tileX, hit.tileY);
  return result.state;
}

export function computeHoverView(state: PlacementState): HoverView {
  if (
    state.mode !== 'placement' ||
    state.hoveredTile === null ||
    state.selectedUnitType === null
  ) {
    return { highlight: false };
  }
  const { tileX, tileY } = state.hoveredTile;
  return {
    highlight: true,
    tileX,
    tileY,
    colorHex: hoverColorFor(state.selectedUnitType),
  };
}
