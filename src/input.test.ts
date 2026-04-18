import { describe, it, expect, vi } from 'vitest';
import { createKeydownHandler, attachInputHandlers } from './input';
import { INITIAL_STATE, type PlacementState } from './placement';

function makeCanvas(): HTMLCanvasElement {
  return { style: { cursor: 'default' } } as unknown as HTMLCanvasElement;
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

describe('attachInputHandlers', () => {
  it('binds a keydown listener and detach() removes it (post-detach dispatch is a no-op)', () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListener) => {
        if (listeners.get(type) === listener) {
          listeners.delete(type);
        }
      }),
    } satisfies Pick<Window, 'addEventListener' | 'removeEventListener'>;

    const holder = stateHolder(INITIAL_STATE);
    const canvas = makeCanvas();
    const handle = attachInputHandlers({ ...holder, canvas, target });

    expect(target.addEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);

    const bound = listeners.get('keydown')!;
    bound({ key: '1' } as unknown as Event);
    expect(holder.getState().selectedUnitType).toBe('blue');

    const priorSetCount = holder.setCount();
    handle.detach();
    expect(target.removeEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);

    // After detach, the target no longer dispatches to our listener. Simulate a
    // keydown by looking up whatever listener the target holds — there is none,
    // so setState must not be called again.
    const afterDetachListener = listeners.get('keydown');
    expect(afterDetachListener).toBeUndefined();
    expect(holder.setCount()).toBe(priorSetCount);
    expect(holder.getState().selectedUnitType).toBe('blue');
  });
});
