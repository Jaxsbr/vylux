import {
  handleClick,
  handleKey,
  handlePointerMove,
  type PlacementState,
  type TileRef,
} from './placement';

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

export type PointerMoveHandlerOptions = {
  getState: () => PlacementState;
  setState: (next: PlacementState) => void;
  raycastPointer: (clientX: number, clientY: number) => TileRef | null;
};

export function createPointerMoveHandler(
  options: PointerMoveHandlerOptions,
): (event: PointerEvent) => void {
  const { getState, setState, raycastPointer } = options;
  return (event: PointerEvent): void => {
    const current = getState();
    const hit = raycastPointer(event.clientX, event.clientY);
    const next = handlePointerMove(current, hit);
    if (next === current) {
      return;
    }
    setState(next);
  };
}

export type PointerDownHandlerOptions = {
  getState: () => PlacementState;
  setState: (next: PlacementState) => void;
  raycastPointer: (clientX: number, clientY: number) => TileRef | null;
  canvas: HTMLCanvasElement;
};

export function createPointerDownHandler(
  options: PointerDownHandlerOptions,
): (event: PointerEvent) => void {
  const { getState, setState, raycastPointer, canvas } = options;
  return (event: PointerEvent): void => {
    const current = getState();
    const hit = raycastPointer(event.clientX, event.clientY);
    const next = handleClick(current, hit, event.button);
    if (next === current) {
      return;
    }
    setState(next);
    if (next.mode === 'idle') {
      canvas.style.cursor = 'default';
    }
  };
}

type WindowTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;
type CanvasTarget = Pick<HTMLCanvasElement, 'addEventListener' | 'removeEventListener'>;

export type AttachInputHandlersOptions = KeydownHandlerOptions & {
  target: WindowTarget;
  raycastPointer: (clientX: number, clientY: number) => TileRef | null;
};

export type InputHandlers = {
  detach: () => void;
};

export function attachInputHandlers(options: AttachInputHandlersOptions): InputHandlers {
  const { target, canvas, raycastPointer, getState, setState } = options;

  const keydownHandler = createKeydownHandler({ getState, setState, canvas });
  const keydownListener = keydownHandler as EventListener;
  target.addEventListener('keydown', keydownListener);

  const pointerMoveHandler = createPointerMoveHandler({ getState, setState, raycastPointer });
  const pointerMoveListener = pointerMoveHandler as EventListener;
  const canvasTarget = canvas as CanvasTarget;
  canvasTarget.addEventListener('pointermove', pointerMoveListener);

  const pointerDownHandler = createPointerDownHandler({
    getState,
    setState,
    raycastPointer,
    canvas,
  });
  const pointerDownListener = pointerDownHandler as EventListener;
  canvasTarget.addEventListener('pointerdown', pointerDownListener);

  return {
    detach: () => {
      target.removeEventListener('keydown', keydownListener);
      canvasTarget.removeEventListener('pointermove', pointerMoveListener);
      canvasTarget.removeEventListener('pointerdown', pointerDownListener);
    },
  };
}
