import { describe, it, expect } from 'vitest';
import {
  INITIAL_STATE,
  handleKey,
  handlePointerMove,
  hoverColorFor,
  ghostEmissiveFor,
  isTileOccupied,
  computeGhostView,
  computeHoverView,
  tryPlace,
  type PlacementState,
} from './placement';

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

describe('handlePointerMove — hovered tile tracking (phase-goal L55)', () => {
  it('5 sequential moves leave hoveredTile equal to the last coord only', () => {
    const coords = [
      { tileX: 0, tileY: 0 },
      { tileX: 1, tileY: 1 },
      { tileX: 2, tileY: 5 },
      { tileX: 10, tileY: 3 },
      { tileX: 19, tileY: 19 },
    ];
    let s: PlacementState = blue;
    for (const c of coords) s = handlePointerMove(s, c);
    expect(s.hoveredTile).toEqual({ tileX: 19, tileY: 19 });
    expect(s.mode).toBe('placement');
    expect(s.selectedUnitType).toBe('blue');
  });

  it('same-coord repeat is a no-op (returns same reference)', () => {
    const once = handlePointerMove(idle, { tileX: 4, tileY: 4 });
    const twice = handlePointerMove(once, { tileX: 4, tileY: 4 });
    expect(twice).toBe(once);
  });

  it('null hit from non-null hoveredTile clears to null (fresh object)', () => {
    const hovering = handlePointerMove(idle, { tileX: 2, tileY: 2 });
    const cleared = handlePointerMove(hovering, null);
    expect(cleared).not.toBe(hovering);
    expect(cleared.hoveredTile).toBeNull();
  });

  it('null hit when already null is a no-op (returns same reference)', () => {
    expect(handlePointerMove(idle, null)).toBe(idle);
  });

  it('preserves mode / selectedUnitType / placedUnits', () => {
    const state: PlacementState = {
      mode: 'placement',
      selectedUnitType: 'red',
      hoveredTile: null,
      placedUnits: [{ tileX: 7, tileY: 7, type: 'blue' }],
    };
    const next = handlePointerMove(state, { tileX: 8, tileY: 9 });
    expect(next.mode).toBe('placement');
    expect(next.selectedUnitType).toBe('red');
    expect(next.placedUnits).toBe(state.placedUnits);
    expect(next.hoveredTile).toEqual({ tileX: 8, tileY: 9 });
  });

  it('does not mutate the input state', () => {
    const state: PlacementState = {
      mode: 'placement',
      selectedUnitType: 'blue',
      hoveredTile: null,
      placedUnits: [],
    };
    const snap = JSON.stringify(state);
    handlePointerMove(state, { tileX: 1, tileY: 1 });
    expect(JSON.stringify(state)).toBe(snap);
  });
});

describe('hoverColorFor / ghostEmissiveFor (phase-goal L46, L73-74, L81-82)', () => {
  it('blue -> dim cyan #0d4d57', () => {
    expect(hoverColorFor('blue')).toBe('#0d4d57');
  });
  it('red -> dim red-orange #5a2311', () => {
    expect(hoverColorFor('red')).toBe('#5a2311');
  });
  it('ghost blue emissive -> #00e5ff', () => {
    expect(ghostEmissiveFor('blue')).toBe('#00e5ff');
  });
  it('ghost red emissive -> #ff5a1f', () => {
    expect(ghostEmissiveFor('red')).toBe('#ff5a1f');
  });
});

describe('isTileOccupied', () => {
  const occupied: PlacementState = {
    mode: 'placement',
    selectedUnitType: 'blue',
    hoveredTile: null,
    placedUnits: [
      { tileX: 3, tileY: 4, type: 'blue' },
      { tileX: 10, tileY: 11, type: 'red' },
    ],
  };

  it('returns true for a placed unit coord', () => {
    expect(isTileOccupied(occupied, 3, 4)).toBe(true);
    expect(isTileOccupied(occupied, 10, 11)).toBe(true);
  });
  it('returns false for an empty tile', () => {
    expect(isTileOccupied(occupied, 0, 0)).toBe(false);
    expect(isTileOccupied(occupied, 3, 5)).toBe(false);
  });
  it('returns false on empty placedUnits', () => {
    expect(isTileOccupied(idle, 3, 4)).toBe(false);
  });
});

describe('computeGhostView', () => {
  it('idle -> visible: false', () => {
    expect(computeGhostView(idle)).toEqual({ visible: false });
  });

  it('placement without hoveredTile -> visible: false', () => {
    expect(computeGhostView(blue)).toEqual({ visible: false });
  });

  it('placement + blue + hovered empty tile -> visible cyan at coord', () => {
    const state: PlacementState = { ...blue, hoveredTile: { tileX: 3, tileY: 7 } };
    expect(computeGhostView(state)).toEqual({
      visible: true,
      tileX: 3,
      tileY: 7,
      emissiveHex: '#00e5ff',
    });
  });

  it('placement + red + hovered empty tile -> visible red-orange at coord', () => {
    const state: PlacementState = { ...red, hoveredTile: { tileX: 2, tileY: 2 } };
    expect(computeGhostView(state)).toEqual({
      visible: true,
      tileX: 2,
      tileY: 2,
      emissiveHex: '#ff5a1f',
    });
  });

  it('placement + hovered OCCUPIED tile -> visible: false (occupied signal)', () => {
    const state: PlacementState = {
      mode: 'placement',
      selectedUnitType: 'blue',
      hoveredTile: { tileX: 4, tileY: 4 },
      placedUnits: [{ tileX: 4, tileY: 4, type: 'red' }],
    };
    expect(computeGhostView(state)).toEqual({ visible: false });
  });
});

describe('computeHoverView', () => {
  it('idle -> highlight: false', () => {
    expect(computeHoverView(idle)).toEqual({ highlight: false });
  });

  it('placement without hoveredTile -> highlight: false', () => {
    expect(computeHoverView(blue)).toEqual({ highlight: false });
  });

  it('placement + blue + hovered tile -> highlight dim cyan', () => {
    const state: PlacementState = { ...blue, hoveredTile: { tileX: 3, tileY: 7 } };
    expect(computeHoverView(state)).toEqual({
      highlight: true,
      tileX: 3,
      tileY: 7,
      colorHex: '#0d4d57',
    });
  });

  it('placement + red + hovered tile -> highlight dim red-orange (even if occupied)', () => {
    const state: PlacementState = {
      mode: 'placement',
      selectedUnitType: 'red',
      hoveredTile: { tileX: 5, tileY: 5 },
      placedUnits: [{ tileX: 5, tileY: 5, type: 'blue' }],
    };
    expect(computeHoverView(state)).toEqual({
      highlight: true,
      tileX: 5,
      tileY: 5,
      colorHex: '#5a2311',
    });
  });
});

describe('tryPlace — click placement + occupancy (phase-goal L58-L60)', () => {
  const placementBlue: PlacementState = {
    mode: 'placement',
    selectedUnitType: 'blue',
    hoveredTile: { tileX: 5, tileY: 5 },
    placedUnits: [],
  };

  it('unoccupied tile in placement -> ok:true, placedUnits += 1, mode idle, selectedUnitType null', () => {
    const result = tryPlace(placementBlue, 5, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.placedUnits).toHaveLength(1);
    expect(result.state.placedUnits[0]).toEqual({ tileX: 5, tileY: 5, type: 'blue' });
    expect(result.state.mode).toBe('idle');
    expect(result.state.selectedUnitType).toBeNull();
    expect(result.state.hoveredTile).toEqual({ tileX: 5, tileY: 5 });
  });

  it('red faction placement preserved on placed unit', () => {
    const red: PlacementState = { ...placementBlue, selectedUnitType: 'red' };
    const result = tryPlace(red, 7, 3);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.placedUnits[0]).toEqual({ tileX: 7, tileY: 3, type: 'red' });
  });

  it('occupied tile -> ok:false reason occupied, state same reference', () => {
    const withUnit: PlacementState = {
      ...placementBlue,
      placedUnits: [{ tileX: 5, tileY: 5, type: 'red' }],
    };
    const result = tryPlace(withUnit, 5, 5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('occupied');
    expect(result.state).toBe(withUnit);
  });

  it('out-of-bounds coords -> ok:false reason out-of-bounds, state same reference', () => {
    const cases: Array<[number, number]> = [
      [-1, 0],
      [0, 20],
      [20, 20],
      [0, -1],
      [100, 5],
    ];
    for (const [tx, ty] of cases) {
      const result = tryPlace(placementBlue, tx, ty);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('out-of-bounds');
      expect(result.state).toBe(placementBlue);
    }
  });

  it('non-integer / NaN coords -> ok:false reason out-of-bounds', () => {
    for (const [tx, ty] of [
      [NaN, 0],
      [0, NaN],
      [0.5, 1],
      [1, 2.3],
    ] as Array<[number, number]>) {
      const result = tryPlace(placementBlue, tx, ty);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).toBe('out-of-bounds');
      expect(result.state).toBe(placementBlue);
    }
  });

  it('not-in-placement mode -> ok:false reason not-in-placement, state same reference', () => {
    const result = tryPlace(INITIAL_STATE, 3, 3);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('not-in-placement');
    expect(result.state).toBe(INITIAL_STATE);
  });

  it('does not mutate the input state on success', () => {
    const snap = JSON.stringify(placementBlue);
    tryPlace(placementBlue, 9, 9);
    expect(JSON.stringify(placementBlue)).toBe(snap);
  });
});
