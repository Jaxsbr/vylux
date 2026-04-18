import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, handleKey, type PlacementState } from './placement';

const idle: PlacementState = INITIAL_STATE;
const blue: PlacementState = { ...idle, mode: 'placement', selectedUnitType: 'blue' };
const red: PlacementState = { ...idle, mode: 'placement', selectedUnitType: 'red' };

describe('handleKey — named transitions (phase-goal.md L36-L41)', () => {
  it('idle + "1" -> placement + blue', () => {
    const next = handleKey(idle, '1');
    expect(next.mode).toBe('placement');
    expect(next.selectedUnitType).toBe('blue');
  });

  it('idle + "2" -> placement + red', () => {
    const next = handleKey(idle, '2');
    expect(next.mode).toBe('placement');
    expect(next.selectedUnitType).toBe('red');
  });

  it('placement+red + "1" -> placement + blue', () => {
    const next = handleKey(red, '1');
    expect(next.mode).toBe('placement');
    expect(next.selectedUnitType).toBe('blue');
  });

  it('placement+blue + "2" -> placement + red', () => {
    const next = handleKey(blue, '2');
    expect(next.mode).toBe('placement');
    expect(next.selectedUnitType).toBe('red');
  });

  it('placement + "Escape" -> idle + null', () => {
    const next = handleKey(blue, 'Escape');
    expect(next.mode).toBe('idle');
    expect(next.selectedUnitType).toBeNull();
  });

  it('unhandled keys leave state unchanged and throw no errors', () => {
    for (const key of ['a', '3', 'Enter', 'Space', 'Shift']) {
      const nextIdle = handleKey(idle, key);
      expect(nextIdle).toBe(idle);
      const nextBlue = handleKey(blue, key);
      expect(nextBlue).toBe(blue);
    }
  });
});

describe('handleKey — no-op identity', () => {
  it('Escape from idle returns the same reference', () => {
    const next = handleKey(idle, 'Escape');
    expect(next).toBe(idle);
  });

  it('same-faction key in placement returns the same reference', () => {
    expect(handleKey(blue, '1')).toBe(blue);
    expect(handleKey(red, '2')).toBe(red);
  });
});

describe('handleKey — immutability', () => {
  it('does not mutate the input state on a real transition', () => {
    const snapshot = JSON.stringify(idle);
    handleKey(idle, '1');
    expect(JSON.stringify(idle)).toBe(snapshot);
  });

  it('preserves hoveredTile and placedUnits across transitions', () => {
    const withHoverAndUnits: PlacementState = {
      mode: 'placement',
      selectedUnitType: 'blue',
      hoveredTile: { tileX: 3, tileY: 7 },
      placedUnits: [{ tileX: 1, tileY: 2, type: 'blue' }],
    };
    const after = handleKey(withHoverAndUnits, 'Escape');
    expect(after.hoveredTile).toEqual({ tileX: 3, tileY: 7 });
    expect(after.placedUnits).toEqual([{ tileX: 1, tileY: 2, type: 'blue' }]);
  });
});
