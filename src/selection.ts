import type { WorkerBundle } from './worker';

// Single-select state for the blue faction worker.
// Only one worker can be selected at a time.
// Red workers are never selectable by the player.

let selected: WorkerBundle | null = null;

export function selectWorker(worker: WorkerBundle | null): void {
  if (selected !== null) {
    selected.selectionRing.visible = false;
  }
  selected = worker;
  if (selected !== null) {
    selected.selectionRing.visible = true;
  }
}

export function getSelected(): WorkerBundle | null {
  return selected;
}
