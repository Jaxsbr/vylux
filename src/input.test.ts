import { describe, it, expect, vi } from 'vitest';
import {
  createKeydownHandler,
  createPointerMoveHandler,
  createPointerDownHandler,
  attachInputHandlers,
} from './input';
import { INITIAL_STATE, type PlacementState, type TileRef } from './placement';

function makeCanvas(
  listeners?: Map<string, EventListener>,
): HTMLCanvasElement {
  const canvas: Partial<HTMLCanvasElement> = {
    style: { cursor: 'default' } as CSSStyleDeclaration,
  };
  if (listeners) {
    canvas.addEventListener = ((type: string, listener: EventListener) => {
      listeners.set(`canvas:${type}`, listener);
    }) as HTMLCanvasElement['addEventListener'];
    canvas.removeEventListener = ((type: string, listener: EventListener) => {
      if (listeners.get(`canvas:${type}`) === listener) {
        listeners.delete(`canvas:${type}`);
      }
    }) as HTMLCanvasElement['removeEventListener'];
  }
  return canvas as HTMLCanvasElement;
}

function stateHolder(initial: PlacementState): {
  getState: () => PlacementState;
  setState: (next: PlacementState) => void;
  setCount: () => number;
} {
  let current = initial;
  let setCount = 0;
  return {
    getState: () => current,
    setState: (next: PlacementState) => {
      current = next;
      setCount++;
    },
    setCount: () => setCount,
  };
}

describe('createKeydownHandler', () => {
  it('"1" from idle -> placement+blue and cursor "none"', () => {
    const holder = stateHolder(INITIAL_STATE);
    const canvas = makeCanvas();
    const handler = createKeydownHandler({ ...holder, canvas });
    handler({ key: '1' } as KeyboardEvent);
    const s = holder.getState();
    expect(s.mode).toBe('placement');
    expect(s.selectedUnitType).toBe('blue');
    expect(canvas.style.cursor).toBe('none');
  });

  it('"2" from idle -> placement+red and cursor "none"', () => {
    const holder = stateHolder(INITIAL_STATE);
    const canvas = makeCanvas();
    const handler = createKeydownHandler({ ...holder, canvas });
    handler({ key: '2' } as KeyboardEvent);
    const s = holder.getState();
    expect(s.mode).toBe('placement');
    expect(s.selectedUnitType).toBe('red');
    expect(canvas.style.cursor).toBe('none');
  });

  it('"Escape" from placement -> idle and cursor "default"', () => {
    const holder = stateHolder({
      mode: 'placement',
      selectedUnitType: 'blue',
      hoveredTile: null,
      placedUnits: [],
    });
    const canvas = makeCanvas();
    canvas.style.cursor = 'none';
    const handler = createKeydownHandler({ ...holder, canvas });
    handler({ key: 'Escape' } as KeyboardEvent);
    const s = holder.getState();
    expect(s.mode).toBe('idle');
    expect(s.selectedUnitType).toBeNull();
    expect(canvas.style.cursor).toBe('default');
  });

  it('unhandled key leaves state and cursor untouched (no setState call)', () => {
    const holder = stateHolder(INITIAL_STATE);
    const canvas = makeCanvas();
    const handler = createKeydownHandler({ ...holder, canvas });
    for (const key of ['a', '3', 'Enter', 'Shift']) {
      handler({ key } as KeyboardEvent);
    }
    expect(holder.setCount()).toBe(0);
    expect(holder.getState()).toBe(INITIAL_STATE);
    expect(canvas.style.cursor).toBe('default');
  });

  it('same-faction repeat in placement is a no-op (no setState call)', () => {
    const holder = stateHolder({
      mode: 'placement',
      selectedUnitType: 'blue',
      hoveredTile: null,
      placedUnits: [],
    });
    const canvas = makeCanvas();
    canvas.style.cursor = 'none';
    const handler = createKeydownHandler({ ...holder, canvas });
    handler({ key: '1' } as KeyboardEvent);
    expect(holder.setCount()).toBe(0);
    expect(canvas.style.cursor).toBe('none');
  });
});

describe('createPointerMoveHandler', () => {
  it('dispatches handlePointerMove with raycast hit; setState updates hoveredTile', () => {
    const holder = stateHolder({
      mode: 'placement',
      selectedUnitType: 'blue',
      hoveredTile: null,
      placedUnits: [],
    });
    const raycastPointer = (cx: number, cy: number): TileRef | null =>
      cx < 0 || cy < 0 ? null : { tileX: 5, tileY: 7 };
    const handler = createPointerMoveHandler({ ...holder, raycastPointer });
    handler({ clientX: 100, clientY: 100 } as PointerEvent);
    expect(holder.getState().hoveredTile).toEqual({ tileX: 5, tileY: 7 });
  });

  it('null raycast clears hoveredTile', () => {
    const holder = stateHolder({
      mode: 'placement',
      selectedUnitType: 'blue',
      hoveredTile: { tileX: 3, tileY: 3 },
      placedUnits: [],
    });
    const raycastPointer = (): TileRef | null => null;
    const handler = createPointerMoveHandler({ ...holder, raycastPointer });
    handler({ clientX: -1, clientY: -1 } as PointerEvent);
    expect(holder.getState().hoveredTile).toBeNull();
  });

  it('same-coord repeat is a no-op (no setState call)', () => {
    const holder = stateHolder({
      mode: 'placement',
      selectedUnitType: 'blue',
      hoveredTile: { tileX: 2, tileY: 2 },
      placedUnits: [],
    });
    const raycastPointer = (): TileRef | null => ({ tileX: 2, tileY: 2 });
    const handler = createPointerMoveHandler({ ...holder, raycastPointer });
    handler({ clientX: 5, clientY: 5 } as PointerEvent);
    expect(holder.setCount()).toBe(0);
  });
});

describe('createPointerDownHandler', () => {
  it('left-click on a hovered empty tile places a unit, exits to idle, and restores cursor', () => {
    const holder = stateHolder({
      mode: 'placement',
      selectedUnitType: 'blue',
      hoveredTile: { tileX: 4, tileY: 4 },
      placedUnits: [],
    });
    const canvas = makeCanvas();
    canvas.style.cursor = 'none';
    const raycastPointer = (): TileRef | null => ({ tileX: 4, tileY: 4 });
    const handler = createPointerDownHandler({ ...holder, canvas, raycastPointer });
    handler({ clientX: 0, clientY: 0, button: 0 } as PointerEvent);
    const s = holder.getState();
    expect(s.placedUnits).toHaveLength(1);
    expect(s.placedUnits[0]).toEqual({ tileX: 4, tileY: 4, type: 'blue' });
    expect(s.mode).toBe('idle');
    expect(canvas.style.cursor).toBe('default');
  });

  it('right-click (button 2) is a no-op (no setState call, cursor unchanged)', () => {
    const holder = stateHolder({
      mode: 'placement',
      selectedUnitType: 'blue',
      hoveredTile: { tileX: 4, tileY: 4 },
      placedUnits: [],
    });
    const canvas = makeCanvas();
    canvas.style.cursor = 'none';
    const raycastPointer = (): TileRef | null => ({ tileX: 4, tileY: 4 });
    const handler = createPointerDownHandler({ ...holder, canvas, raycastPointer });
    handler({ clientX: 0, clientY: 0, button: 2 } as PointerEvent);
    expect(holder.setCount()).toBe(0);
    expect(canvas.style.cursor).toBe('none');
  });

  it('left-click outside grid (null hit) exits to idle and restores cursor', () => {
    const holder = stateHolder({
      mode: 'placement',
      selectedUnitType: 'red',
      hoveredTile: null,
      placedUnits: [],
    });
    const canvas = makeCanvas();
    canvas.style.cursor = 'none';
    const raycastPointer = (): TileRef | null => null;
    const handler = createPointerDownHandler({ ...holder, canvas, raycastPointer });
    handler({ clientX: 0, clientY: 0, button: 0 } as PointerEvent);
    const s = holder.getState();
    expect(s.mode).toBe('idle');
    expect(s.placedUnits).toHaveLength(0);
    expect(canvas.style.cursor).toBe('default');
  });

  it('left-click on occupied tile is a no-op (no setState call, cursor unchanged)', () => {
    const holder = stateHolder({
      mode: 'placement',
      selectedUnitType: 'blue',
      hoveredTile: { tileX: 2, tileY: 2 },
      placedUnits: [{ tileX: 2, tileY: 2, type: 'red' }],
    });
    const canvas = makeCanvas();
    canvas.style.cursor = 'none';
    const raycastPointer = (): TileRef | null => ({ tileX: 2, tileY: 2 });
    const handler = createPointerDownHandler({ ...holder, canvas, raycastPointer });
    handler({ clientX: 0, clientY: 0, button: 0 } as PointerEvent);
    expect(holder.setCount()).toBe(0);
    expect(canvas.style.cursor).toBe('none');
  });
});

describe('attachInputHandlers', () => {
  it('binds keydown + pointermove + pointerdown listeners and detach() removes all three', () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(`window:${type}`, listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        if (listeners.get(`window:${type}`) === listener) {
          listeners.delete(`window:${type}`);
        }
      }),
    } satisfies Pick<Window, 'addEventListener' | 'removeEventListener'>;

    const holder = stateHolder(INITIAL_STATE);
    const canvas = makeCanvas(listeners);
    const raycastPointer = (): TileRef | null => ({ tileX: 4, tileY: 4 });
    const handle = attachInputHandlers({ ...holder, canvas, target, raycastPointer });

    expect(target.addEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(3);
    expect(listeners.get('window:keydown')).toBeDefined();
    expect(listeners.get('canvas:pointermove')).toBeDefined();
    expect(listeners.get('canvas:pointerdown')).toBeDefined();

    listeners.get('window:keydown')!({ key: '1' } as unknown as Event);
    expect(holder.getState().selectedUnitType).toBe('blue');
    listeners.get('canvas:pointermove')!({ clientX: 5, clientY: 5 } as unknown as Event);
    expect(holder.getState().hoveredTile).toEqual({ tileX: 4, tileY: 4 });
    listeners.get('canvas:pointerdown')!({
      clientX: 5,
      clientY: 5,
      button: 0,
    } as unknown as Event);
    expect(holder.getState().placedUnits).toHaveLength(1);
    expect(holder.getState().placedUnits[0]).toEqual({ tileX: 4, tileY: 4, type: 'blue' });
    expect(holder.getState().mode).toBe('idle');

    handle.detach();
    expect(target.removeEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });
});
