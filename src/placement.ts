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
