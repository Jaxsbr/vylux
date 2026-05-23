// Phase C.3 — audio fail-soft gate.
//
// The synth layer must never crash the game when there's no usable
// AudioContext: Web Audio needs a user gesture to start, the unit-test
// runner has no `window` / `AudioContext` at all, and a browser may
// refuse a context outright. In every one of those cases ensureContext()
// returns null and each cue / the ambient bed must no-op silently.
//
// This test runs in the default node environment (no DOM), so it
// exercises exactly that no-context path: every public method is invoked
// and must return without throwing, muted and unmuted, before and after
// the bed is "started." It does not assert that sound is produced —
// that's the manual listening check noted in the manual's audio section.

import { describe, it, expect } from 'vitest';
import { AudioManager } from './audio-manager';

// Every cue, invoked with valid args. Each entry is a no-arg thunk so the
// test can fan over them uniformly.
function allCues(a: AudioManager): Array<() => void> {
  return [
    () => a.click(),
    () => a.select(),
    () => a.moveAssign(),
    () => a.harvestAssign(),
    () => a.chargeStart(),
    () => a.chargeComplete(),
    () => a.researchStart(),
    () => a.researchComplete(),
    () => a.trainComplete(),
    () => a.buildComplete(),
    () => a.attackHit(),
    () => a.alertHqHit(),
    () => a.factionSwitch('swarm'),
    () => a.factionSwitch('siege'),
  ];
}

describe('AudioManager — fail-soft without an AudioContext', () => {
  it('every cue is a silent no-op when no context is available', () => {
    const a = new AudioManager();
    for (const cue of allCues(a)) {
      expect(cue).not.toThrow();
    }
  });

  it('startAmbientBed is a no-op (and idempotent) without a context', () => {
    const a = new AudioManager();
    expect(() => a.startAmbientBed(0)).not.toThrow();
    expect(() => a.startAmbientBed(1)).not.toThrow(); // already-started branch
  });

  it('cues stay silent when muted', () => {
    const a = new AudioManager();
    a.setMuted(true);
    expect(a.isMuted()).toBe(true);
    for (const cue of allCues(a)) {
      expect(cue).not.toThrow();
    }
    expect(() => a.startAmbientBed(0)).not.toThrow();
  });

  it('mute toggles cleanly with no bed running', () => {
    const a = new AudioManager();
    expect(a.isMuted()).toBe(false);
    expect(() => a.setMuted(true)).not.toThrow();
    expect(a.isMuted()).toBe(true);
    expect(() => a.setMuted(false)).not.toThrow();
    expect(a.isMuted()).toBe(false);
  });
});
