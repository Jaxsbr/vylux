import { describe, it, expect } from 'vitest';
import {
  INITIAL_TRAINING_PANEL_STATE,
  handleHqClick,
  handleBuildableClick,
  handleEscape,
  handlePlacementSuccess,
} from './training-panel-state';

describe('handleHqClick', () => {
  it('opens panel when closed', () => {
    const next = handleHqClick(INITIAL_TRAINING_PANEL_STATE);
    expect(next.panelOpen).toBe(true);
    expect(next.armedKind).toBeNull();
  });

  it('closes panel and disarms when open', () => {
    const open = { panelOpen: true, armedKind: 'worker' as const };
    const next = handleHqClick(open);
    expect(next.panelOpen).toBe(false);
    expect(next.armedKind).toBeNull();
  });

  it('closes panel when open and no armed kind', () => {
    const open = { panelOpen: true, armedKind: null };
    const next = handleHqClick(open);
    expect(next.panelOpen).toBe(false);
  });

  it('returns same ref when already closed and unselected (no-op path guarded)', () => {
    // When already closed, should open (not return same ref).
    const next = handleHqClick(INITIAL_TRAINING_PANEL_STATE);
    expect(next).not.toBe(INITIAL_TRAINING_PANEL_STATE);
    expect(next.panelOpen).toBe(true);
  });
});

describe('handleBuildableClick', () => {
  it('arms a unit kind when panel is open', () => {
    const open = { panelOpen: true, armedKind: null };
    const next = handleBuildableClick(open, 'defender');
    expect(next.armedKind).toBe('defender');
    expect(next.panelOpen).toBe(true);
  });

  it('returns same ref when same kind already armed', () => {
    const state = { panelOpen: true, armedKind: 'worker' as const };
    const next = handleBuildableClick(state, 'worker');
    expect(next).toBe(state);
  });

  it('switches armed kind when different kind selected', () => {
    const state = { panelOpen: true, armedKind: 'worker' as const };
    const next = handleBuildableClick(state, 'raider');
    expect(next.armedKind).toBe('raider');
  });

  it('returns same ref when panel is closed (no-op)', () => {
    const next = handleBuildableClick(INITIAL_TRAINING_PANEL_STATE, 'worker');
    expect(next).toBe(INITIAL_TRAINING_PANEL_STATE);
  });
});

describe('handleEscape', () => {
  it('closes panel and disarms from open+armed state', () => {
    const state = { panelOpen: true, armedKind: 'raider' as const };
    const next = handleEscape(state);
    expect(next.panelOpen).toBe(false);
    expect(next.armedKind).toBeNull();
  });

  it('closes panel from open+unarmed state', () => {
    const state = { panelOpen: true, armedKind: null };
    const next = handleEscape(state);
    expect(next.panelOpen).toBe(false);
  });

  it('returns same ref when already closed and unselected', () => {
    const next = handleEscape(INITIAL_TRAINING_PANEL_STATE);
    expect(next).toBe(INITIAL_TRAINING_PANEL_STATE);
  });
});

describe('handlePlacementSuccess', () => {
  it('disarms but keeps panel open', () => {
    const state = { panelOpen: true, armedKind: 'worker' as const };
    const next = handlePlacementSuccess(state);
    expect(next.panelOpen).toBe(true);
    expect(next.armedKind).toBeNull();
  });

  it('returns same ref when already disarmed and closed', () => {
    const next = handlePlacementSuccess(INITIAL_TRAINING_PANEL_STATE);
    expect(next).toBe(INITIAL_TRAINING_PANEL_STATE);
  });

  it('no-ops gracefully when panel closed but armed (edge case)', () => {
    const state = { panelOpen: false, armedKind: 'defender' as const };
    const next = handlePlacementSuccess(state);
    expect(next.armedKind).toBeNull();
  });
});
