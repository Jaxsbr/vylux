import { describe, expect, it } from 'vitest';
import {
  enterPlacement,
  exitPlacement,
  INITIAL_PLACEMENT,
  setHoveredTile,
  tryPlace,
} from './placement';

describe('placement state machine', () => {
  it('starts in idle mode', () => {
    expect(INITIAL_PLACEMENT.mode).toBe('idle');
    expect(INITIAL_PLACEMENT.unitKind).toBeNull();
    expect(INITIAL_PLACEMENT.hoveredTile).toBeNull();
  });

  it('enterPlacement(kind) sets mode + kind', () => {
    const s = enterPlacement(INITIAL_PLACEMENT, 'worker');
    expect(s.mode).toBe('placement');
    expect(s.unitKind).toBe('worker');
    expect(s.hoveredTile).toBeNull();
  });

  it('enterPlacement is identity-preserving when re-entering same kind', () => {
    const a = enterPlacement(INITIAL_PLACEMENT, 'defender');
    const b = enterPlacement(a, 'defender');
    expect(b).toBe(a);
  });

  it('enterPlacement switches kind without losing placement mode', () => {
    const a = enterPlacement(INITIAL_PLACEMENT, 'worker');
    const b = enterPlacement(a, 'raider');
    expect(b.mode).toBe('placement');
    expect(b.unitKind).toBe('raider');
    expect(b).not.toBe(a);
  });

  it('exitPlacement returns to idle', () => {
    const a = enterPlacement(INITIAL_PLACEMENT, 'worker');
    const b = exitPlacement(a);
    expect(b.mode).toBe('idle');
    expect(b.unitKind).toBeNull();
  });

  it('exitPlacement is identity when already idle', () => {
    expect(exitPlacement(INITIAL_PLACEMENT)).toBe(INITIAL_PLACEMENT);
  });

  it('setHoveredTile updates hovered coords in placement mode', () => {
    const a = enterPlacement(INITIAL_PLACEMENT, 'worker');
    const b = setHoveredTile(a, { x: 5, y: 7 });
    expect(b.hoveredTile).toEqual({ x: 5, y: 7 });
  });

  it('setHoveredTile is identity when same tile re-set', () => {
    const a = setHoveredTile(enterPlacement(INITIAL_PLACEMENT, 'worker'), { x: 3, y: 4 });
    const b = setHoveredTile(a, { x: 3, y: 4 });
    expect(b).toBe(a);
  });

  it('setHoveredTile clears hovered when in idle mode', () => {
    const a: ReturnType<typeof enterPlacement> = {
      mode: 'idle',
      unitKind: null,
      hoveredTile: { x: 3, y: 4 },
    };
    const b = setHoveredTile(a, { x: 5, y: 5 });
    expect(b.hoveredTile).toBeNull();
  });

  it('tryPlace returns ok with command coords + resets to idle', () => {
    const a = enterPlacement(INITIAL_PLACEMENT, 'worker');
    const result = tryPlace(a, 20, 7, 9);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.unitKind).toBe('worker');
    expect(result.x).toBe(7);
    expect(result.y).toBe(9);
    expect(result.state.mode).toBe('idle');
  });

  it('tryPlace rejects when not in placement mode', () => {
    const result = tryPlace(INITIAL_PLACEMENT, 20, 5, 5);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('not-in-placement');
    expect(result.state).toBe(INITIAL_PLACEMENT);
  });

  it('tryPlace rejects out-of-bounds', () => {
    const a = enterPlacement(INITIAL_PLACEMENT, 'worker');
    for (const [x, y] of [[-1, 5], [20, 5], [5, -1], [5, 20], [99, 99]]) {
      const r = tryPlace(a, 20, x, y);
      expect(r.ok).toBe(false);
      if (r.ok) throw new Error('unreachable');
      expect(r.reason).toBe('out-of-bounds');
      expect(r.state).toBe(a); // identity preserved on reject
    }
  });
});
