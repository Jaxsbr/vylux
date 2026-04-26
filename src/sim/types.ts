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

export type UnitKind = 'worker' | 'defender' | 'raider';

export interface FactionState {
  hqX: Fixed;
  hqY: Fixed;
  energy: Fixed;
}

export type WorkerPhase = 'idle' | 'movingToNode' | 'harvesting' | 'returning';

// Common fields on every unit. Combat applies to all units (workers can
// be killed by raiders), so HP and cooldown live here. attackCooldown is
// always present but is meaningless for units whose kind has zero damage
// (workers); the field is kept on the base for hash-stability across
// kinds rather than as kind-specific data.
interface UnitBase {
  id: number;
  alive: boolean;
  faction: Faction;
  x: Fixed;
  y: Fixed;
  hp: Fixed;
  attackCooldown: number;
}

export interface Worker extends UnitBase {
  kind: 'worker';
  phase: WorkerPhase;
  targetNodeId: number; // 0 = no target
  carrying: Fixed; // energy units in transit
  harvestTicksRemaining: number;
}

export interface Defender extends UnitBase {
  kind: 'defender';
  // Defenders are stationary in Phase 1 — no movement state required.
  // Add patrol targets later if the design calls for it.
}

export interface Raider extends UnitBase {
  kind: 'raider';
  // Raiders march toward the enemy HQ by default. No explicit target
  // field yet — the step function reads the opposing faction's HQ
  // directly. Adding a per-raider override (e.g. "attack this worker")
  // is straightforward when the design needs it.
}

export type Unit = Worker | Defender | Raider;

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
  units: Unit[];
  nodes: EnergyNode[];
  nextEntityId: number;
  // Set when a faction's HQ is destroyed or a points threshold is hit.
  // Phase 1.2 fills in the points side; Phase 1.0 only writes this on
  // HQ kill (which we don't do yet). Keeping the field present keeps
  // hash format stable across sub-phases.
  winner: Faction | null;
}
