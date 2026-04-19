// Pure state machine for the mouse-driven training panel.
// Owns: { panelOpen, armedKind }
// No imports from scene.ts or input.ts.

import type { UnitKind } from './units-config';

export type TrainingPanelState = {
  panelOpen: boolean;
  armedKind: UnitKind | null;
};

export const INITIAL_TRAINING_PANEL_STATE: TrainingPanelState = {
  panelOpen: false,
  armedKind: null,
};

/** Toggle panel open when HQ is clicked. If already open, close and disarm. */
export function handleHqClick(state: TrainingPanelState): TrainingPanelState {
  if (state.panelOpen) {
    if (!state.panelOpen && state.armedKind === null) return state;
    return { panelOpen: false, armedKind: null };
  }
  return { panelOpen: true, armedKind: null };
}

/** Arm a unit kind. Panel must be open; if already armed with same kind, stays armed. */
export function handleBuildableClick(
  state: TrainingPanelState,
  kind: UnitKind,
): TrainingPanelState {
  if (!state.panelOpen) return state;
  if (state.armedKind === kind) return state;
  return { ...state, armedKind: kind };
}

/** Escape key: close panel and disarm. */
export function handleEscape(state: TrainingPanelState): TrainingPanelState {
  if (!state.panelOpen && state.armedKind === null) return state;
  return { panelOpen: false, armedKind: null };
}

/**
 * After a successful tile placement: disarm but keep panel open.
 */
export function handlePlacementSuccess(state: TrainingPanelState): TrainingPanelState {
  if (!state.panelOpen && state.armedKind === null) return state;
  return { ...state, armedKind: null };
}
