import { describe, it, expect } from 'vitest';
import {
  INITIAL_ONBOARDING_CUE_STATE,
  dismissCue,
  resetCue,
  shouldShowCue,
} from './onboarding-cue';

describe('shouldShowCue', () => {
  it('returns true on fresh match start', () => {
    expect(shouldShowCue(INITIAL_ONBOARDING_CUE_STATE)).toBe(true);
  });

  it('returns false after dismiss', () => {
    const dismissed = dismissCue(INITIAL_ONBOARDING_CUE_STATE);
    expect(shouldShowCue(dismissed)).toBe(false);
  });

  it('returns true after reset', () => {
    const dismissed = dismissCue(INITIAL_ONBOARDING_CUE_STATE);
    const fresh = resetCue(dismissed);
    expect(shouldShowCue(fresh)).toBe(true);
  });
});

describe('dismissCue', () => {
  it('sets visible=false and dismissed=true', () => {
    const next = dismissCue(INITIAL_ONBOARDING_CUE_STATE);
    expect(next.visible).toBe(false);
    expect(next.dismissed).toBe(true);
  });

  it('returns same ref when already dismissed (no-op)', () => {
    const already = { visible: false, dismissed: true };
    const next = dismissCue(already);
    expect(next).toBe(already);
  });
});

describe('resetCue', () => {
  it('restores visible=true and dismissed=false from dismissed state', () => {
    const dismissed = { visible: false, dismissed: true };
    const next = resetCue(dismissed);
    expect(next.visible).toBe(true);
    expect(next.dismissed).toBe(false);
  });

  it('restores visible=true from any state', () => {
    const next = resetCue(INITIAL_ONBOARDING_CUE_STATE);
    expect(next.visible).toBe(true);
    expect(next.dismissed).toBe(false);
  });

  it('always returns a fresh object', () => {
    const state = INITIAL_ONBOARDING_CUE_STATE;
    const next = resetCue(state);
    expect(next).not.toBe(state);
  });
});
