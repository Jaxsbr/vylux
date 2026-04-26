// Pure placement state machine for click-to-place training.
//
// Mirrors the prototype's placement.ts pattern (now retired): pure
// transitions, discriminated outcomes, identity-preserving no-ops so
// the dispatcher can `if (next === current) return` and skip work.
//
// Lives in src/render/ rather than src/sim/ because placement is a
// per-player UI concept, not a simulation concept. The sim only sees
// the resulting `TrainUnit { x, y }` command.

import type { UnitKind } from '../sim/types';

export interface PlacementState {
  mode: 'idle' | 'placement';
  unitKind: UnitKind | null;
  hoveredTile: { x: number; y: number } | null;
}

export const INITIAL_PLACEMENT: PlacementState = {
  mode: 'idle',
  unitKind: null,
  hoveredTile: null,
};

export function enterPlacement(state: PlacementState, kind: UnitKind): PlacementState {
  if (state.mode === 'placement' && state.unitKind === kind) return state; // identity for re-entry
  return { mode: 'placement', unitKind: kind, hoveredTile: null };
}

export function exitPlacement(state: PlacementState): PlacementState {
  if (state.mode === 'idle') return state;
  return INITIAL_PLACEMENT;
}

export function setHoveredTile(
  state: PlacementState,
  tile: { x: number; y: number } | null,
): PlacementState {
  if (state.mode !== 'placement') {
    return state.hoveredTile === null ? state : { ...state, hoveredTile: null };
  }
  // Same coords → return same ref so the dispatcher short-circuits.
  if (
    (state.hoveredTile === null && tile === null) ||
    (state.hoveredTile !== null &&
      tile !== null &&
      state.hoveredTile.x === tile.x &&
      state.hoveredTile.y === tile.y)
  ) {
    return state;
  }
  return { ...state, hoveredTile: tile };
}

export type PlaceOutcome =
  | { ok: true; unitKind: UnitKind; x: number; y: number; state: PlacementState }
  | { ok: false; reason: 'not-in-placement' | 'out-of-bounds'; state: PlacementState };

// Attempt to place at a tile. Caller is responsible for tile-bounds
// validation (it knows the grid size); this function applies it
// defensively. On success returns the next state (idle) and the
// command coordinates. On failure returns the same state for no-op.
export function tryPlace(
  state: PlacementState,
  gridSize: number,
  tileX: number,
  tileY: number,
): PlaceOutcome {
  if (state.mode !== 'placement' || state.unitKind === null) {
    return { ok: false, reason: 'not-in-placement', state };
  }
  if (tileX < 0 || tileX >= gridSize || tileY < 0 || tileY >= gridSize) {
    return { ok: false, reason: 'out-of-bounds', state };
  }
  return {
    ok: true,
    unitKind: state.unitKind,
    x: tileX,
    y: tileY,
    state: INITIAL_PLACEMENT,
  };
}
