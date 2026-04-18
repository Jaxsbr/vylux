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
