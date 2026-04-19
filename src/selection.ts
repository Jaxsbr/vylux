import type { WorkerBundle } from './worker';
import type { HQBundle } from './hq';

// Single-select state for the blue faction.
// Either a worker or the blue HQ can be selected — never both at once.
// Red workers and red HQ are never selectable by the player.

type SelectionKind =
  | { kind: 'worker'; worker: WorkerBundle }
  | { kind: 'hq'; hq: HQBundle }
  | { kind: 'none' };

let selection: SelectionKind = { kind: 'none' };

function clearCurrent(): void {
  if (selection.kind === 'worker') {
    selection.worker.selectionRing.visible = false;
  } else if (selection.kind === 'hq') {
    selection.hq.selectionRing.visible = false;
  }
}

export function selectWorker(worker: WorkerBundle | null): void {
  clearCurrent();
  if (worker === null) {
    selection = { kind: 'none' };
  } else {
    selection = { kind: 'worker', worker };
    worker.selectionRing.visible = true;
  }
}

export function selectHq(hq: HQBundle | null): void {
  clearCurrent();
  if (hq === null) {
    selection = { kind: 'none' };
  } else {
    selection = { kind: 'hq', hq };
    hq.selectionRing.visible = true;
  }
}

export function getSelected(): WorkerBundle | null {
  if (selection.kind === 'worker') return selection.worker;
  return null;
}

export function getSelectedHq(): HQBundle | null {
  if (selection.kind === 'hq') return selection.hq;
  return null;
}

export function getSelectionKind(): 'none' | 'worker' | 'hq' {
  return selection.kind;
}

export function clearSelection(): void {
  clearCurrent();
  selection = { kind: 'none' };
}
