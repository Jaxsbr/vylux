import { handleKey, type PlacementState } from './placement';

export type KeydownHandlerOptions = {
  getState: () => PlacementState;
  setState: (next: PlacementState) => void;
  canvas: HTMLCanvasElement;
};

export function createKeydownHandler(
  options: KeydownHandlerOptions,
): (event: KeyboardEvent) => void {
  const { getState, setState, canvas } = options;
  return (event: KeyboardEvent): void => {
    const current = getState();
    const next = handleKey(current, event.key);
    if (next === current) {
      return;
    }
    setState(next);
    canvas.style.cursor = next.mode === 'placement' ? 'none' : 'default';
  };
}

type ListenerTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export type AttachInputHandlersOptions = KeydownHandlerOptions & {
  target: ListenerTarget;
};

export type InputHandlers = {
  detach: () => void;
};

export function attachInputHandlers(options: AttachInputHandlersOptions): InputHandlers {
  const { target } = options;
  const handler = createKeydownHandler(options);
  const listener = handler as EventListener;
  target.addEventListener('keydown', listener);
  return {
    detach: () => {
      target.removeEventListener('keydown', listener);
    },
  };
}
