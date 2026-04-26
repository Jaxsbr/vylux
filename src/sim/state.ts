// Initial-state factory and entity-lookup helpers.
//
// Lookup uses linear scan rather than a Map<id, index> on purpose:
// (a) entity counts in this spike are small (~tens), (b) array iteration is
// cache-friendly and bit-stable, (c) avoids the Map iteration-order
// question entirely. If profiling later shows this is hot, the upgrade is
// a parallel index array, not a Map.

import { Rng } from './rng';
import type { EnergyNode, FactionState, SimState, Worker } from './types';
import type { Fixed } from './fixed';
import { fromInt } from './fixed';

export interface InitialMatchSpec {
  seed: number | bigint;
  hqs: { faction0: { x: number; y: number }; faction1: { x: number; y: number } };
  nodes: Array<{ x: number; y: number; energy: number }>;
}

export function createInitialState(spec: InitialMatchSpec): { state: SimState; rng: Rng } {
  const rng = new Rng(spec.seed);

  const factions: [FactionState, FactionState] = [
    {
      hqX: fromInt(spec.hqs.faction0.x),
      hqY: fromInt(spec.hqs.faction0.y),
      energy: fromInt(0),
    },
    {
      hqX: fromInt(spec.hqs.faction1.x),
      hqY: fromInt(spec.hqs.faction1.y),
      energy: fromInt(0),
    },
  ];

  const nodes: EnergyNode[] = spec.nodes.map((n, i) => ({
    id: i + 1,
    alive: true,
    x: fromInt(n.x),
    y: fromInt(n.y),
    remaining: fromInt(n.energy),
  }));

  const state: SimState = {
    tick: 0,
    rngState: rng.snapshot(),
    factions,
    workers: [],
    nodes,
    nextEntityId: nodes.length + 1,
  };

  return { state, rng };
}

export function findWorker(state: SimState, id: number): Worker | null {
  for (let i = 0; i < state.workers.length; i++) {
    const w = state.workers[i];
    if (w.id === id && w.alive) return w;
  }
  return null;
}

export function findNode(state: SimState, id: number): EnergyNode | null {
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (n.id === id && n.alive) return n;
  }
  return null;
}

export function spawnWorker(
  state: SimState,
  faction: 0 | 1,
  x: Fixed,
  y: Fixed,
): Worker {
  const w: Worker = {
    id: state.nextEntityId++,
    alive: true,
    faction,
    x,
    y,
    phase: 'idle',
    targetNodeId: 0,
    carrying: 0,
    harvestTicksRemaining: 0,
  };
  state.workers.push(w);
  return w;
}
