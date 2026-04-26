// Shape of the deterministic sim's state.
//
// Design rules in this module:
// - Every field that affects state is either an integer or a Fixed (Q16.16).
//   No floats, no Date, no perf-now.
// - Entities live in arrays indexed by stable IDs (1-based, monotonic).
//   Removals leave a tombstone (alive=false) rather than splicing — this
//   keeps the array order stable across removals so iteration is
//   deterministic without sorting.
// - Mutation is in-place during step(); snapshots come from hash() and
//   from the replay-record layer that records the input log alongside
//   the seed.

import type { Fixed } from './fixed';

export type Faction = 0 | 1;

export interface FactionState {
  hqX: Fixed;
  hqY: Fixed;
  energy: Fixed;
}

export type WorkerPhase = 'idle' | 'movingToNode' | 'harvesting' | 'returning';

export interface Worker {
  id: number;
  alive: boolean;
  faction: Faction;
  x: Fixed;
  y: Fixed;
  phase: WorkerPhase;
  targetNodeId: number; // 0 = no target
  carrying: Fixed; // energy units in transit
  harvestTicksRemaining: number;
}

export interface EnergyNode {
  id: number;
  alive: boolean;
  x: Fixed;
  y: Fixed;
  remaining: Fixed;
}

export interface SimState {
  tick: number;
  rngState: bigint; // mirror of Rng.snapshot() — owned-but-mirrored for hash
  factions: [FactionState, FactionState];
  workers: Worker[];
  nodes: EnergyNode[];
  nextEntityId: number;
}
