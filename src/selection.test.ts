import { describe, it, expect, beforeEach } from 'vitest';
import { selectWorker, getSelected } from './selection';
import { buildWorker } from './worker';

// Reset selection state between tests by clearing before each.
beforeEach(() => {
  selectWorker(null);
});

describe('selectWorker / getSelected', () => {
  it('getSelected returns null initially', () => {
    expect(getSelected()).toBeNull();
  });

  it('selectWorker(w) selects the worker', () => {
    const w = buildWorker('blue', 0, 0);
    selectWorker(w);
    expect(getSelected()).toBe(w);
  });

  it('selectWorker(w) makes the selection ring visible', () => {
    const w = buildWorker('blue', 0, 0);
    expect(w.selectionRing.visible).toBe(false);
    selectWorker(w);
    expect(w.selectionRing.visible).toBe(true);
  });

  it('selectWorker(null) clears the selection', () => {
    const w = buildWorker('blue', 0, 0);
    selectWorker(w);
    selectWorker(null);
    expect(getSelected()).toBeNull();
  });

  it('selectWorker(null) hides the previous selection ring', () => {
    const w = buildWorker('blue', 0, 0);
    selectWorker(w);
    selectWorker(null);
    expect(w.selectionRing.visible).toBe(false);
  });

  it('switching selection hides the old ring and shows the new ring', () => {
    const w1 = buildWorker('blue', 0, 0);
    const w2 = buildWorker('blue', 1, 0);
    selectWorker(w1);
    selectWorker(w2);
    expect(w1.selectionRing.visible).toBe(false);
    expect(w2.selectionRing.visible).toBe(true);
    expect(getSelected()).toBe(w2);
  });

  it('selecting the same worker twice keeps it selected', () => {
    const w = buildWorker('blue', 0, 0);
    selectWorker(w);
    selectWorker(w);
    expect(getSelected()).toBe(w);
    expect(w.selectionRing.visible).toBe(true);
  });
});
