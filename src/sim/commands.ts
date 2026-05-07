// Player input commands consumed by the deterministic sim.
//
// A command is what gets sent over the network in lockstep multiplayer:
// small, plain-data, no engine references. The sim applies commands at
// the start of each tick before stepping mechanics.
//
// Command IDs are dense small integers so the replay log can compact them
// later. Adding a command is an additive change — never reuse an ID, even
// after removal.

import type { Faction, StructureKind, UnitKind } from './types';

export const enum CommandKind {
  Noop = 0,
  AssignWorkerToNode = 1,
  SpawnUnit = 2, // dev-only entrypoint for tests; production lobby uses initial state + TrainUnit
  TrainUnit = 3, // worker training at HQ. Phase 3.0: combat unitKinds are silently rejected — train them at a production building via TrainAtStructure.
  BuildStructure = 4, // Phase 3.0: place a production building at a tile (energy + build time)
  TrainAtStructure = 5, // Phase 3.0: train a combat unit at a specific production building (energy + train time)
  ResearchTier2 = 6, // Phase 3.1 SCAFFOLD — REMOVED in 3.2. The standalone "spend Flux to flip a flag" path validated the deduction shape; production code now uses ResearchTier2AtStructure (structure-gated). The enum slot is reserved (never reused — see header comment).
  ResearchTier2AtStructure = 7, // Phase 3.2: research tier 2 at a faction-owned upgrade structure (Flux cost + research time). Sets faction.tier2Researched on completion.
  MoveUnit = 8, // Phase 3.3: manual move-order for a single unit. Workers cancel harvest and walk + park there; raiders/vanguards take it as a temporary override of the march-to-HQ default; defenders silently ignore (stationary).
  ActivateEnergyDump = 9, // Phase 3.7: worker-only ability. Spends DUMP_ENERGY_COST upfront; for DUMP_DURATION_TICKS the worker moves at 2× speed and bleeds a deadly trail segment per tick. Per-tick collision sweep kills enemy units overlapping segments.
  ResearchTrailDurationAtStructure = 10, // Phase 3.7: research at a Spire that doubles TRAIL_SEGMENT_LIFETIME for the faction's trails. Same shape as ResearchTier2AtStructure but with researchKind = 'trailDuration'.
  BuildStructureByWorker = 11, // Phase 3.10.6: place a structure that requires a worker to construct it. Spawns the structure (with full buildTicksRemaining) and assigns the named worker to walk to + build it. Replaces the player path through BuildStructure (slot 4 retained for replay back-compat + AI's instant-build path during 3.10.6 transition).
  AssignWorkerToBuild = 12, // Phase 3.10.7: ask an additional worker to join an in-progress build. Sets the worker on phase 'building' targeting the named structure. Multi-worker builds tick down faster.
}

export interface NoopCommand {
  kind: CommandKind.Noop;
}

export interface AssignWorkerToNodeCommand {
  kind: CommandKind.AssignWorkerToNode;
  workerId: number;
  nodeId: number;
}

export interface SpawnUnitCommand {
  kind: CommandKind.SpawnUnit;
  unitKind: UnitKind;
  faction: Faction;
  // Tile coords (will be converted to Fixed at apply time).
  x: number;
  y: number;
}

export interface TrainUnitCommand {
  kind: CommandKind.TrainUnit;
  faction: Faction;
  unitKind: UnitKind;
  // Optional spawn tile. When omitted, the unit spawns at the faction's
  // HQ position (back-compat: tests + AI continue to work unchanged).
  // When provided, the unit spawns at the given integer tile coords —
  // sim does not validate range; the input layer is expected to clamp
  // to grid bounds.
  x?: number;
  y?: number;
}

export interface BuildStructureCommand {
  kind: CommandKind.BuildStructure;
  faction: Faction;
  structureKind: StructureKind;
  // Tile coords (integer). Sim does not validate position vs map
  // bounds, vs occupied tiles, vs collision with other entities — the
  // input layer is expected to clamp / reject. Phase 3.5 introduces
  // map data + tile occupancy; until then, two buildings can sit on
  // the same tile without consequence beyond visual overlap.
  x: number;
  y: number;
}

export interface TrainAtStructureCommand {
  kind: CommandKind.TrainAtStructure;
  structureId: number;
  unitKind: UnitKind;
}

export interface ResearchTier2AtStructureCommand {
  kind: CommandKind.ResearchTier2AtStructure;
  // Upgrade-structure entity ID. Sim verifies the structure is alive,
  // operational (build complete), idle (no research running), and
  // owned by a faction with sufficient Flux.
  structureId: number;
}

export interface MoveUnitCommand {
  kind: CommandKind.MoveUnit;
  unitId: number;
  // Tile coords (integer). Sim does not validate vs map bounds — the
  // input layer clamps. Stored as a Fixed point on the unit at apply
  // time; the unit walks to the integer tile centre.
  x: number;
  y: number;
}

export interface ActivateEnergyDumpCommand {
  kind: CommandKind.ActivateEnergyDump;
  workerId: number;
}

export interface ResearchTrailDurationAtStructureCommand {
  kind: CommandKind.ResearchTrailDurationAtStructure;
  structureId: number;
}

export interface BuildStructureByWorkerCommand {
  kind: CommandKind.BuildStructureByWorker;
  workerId: number;
  structureKind: StructureKind;
  // Tile coords (integer). Sim still doesn't validate position; the
  // input layer is expected to clamp to grid bounds.
  x: number;
  y: number;
}

export interface AssignWorkerToBuildCommand {
  kind: CommandKind.AssignWorkerToBuild;
  workerId: number;
  structureId: number;
}

export type Command =
  | NoopCommand
  | AssignWorkerToNodeCommand
  | SpawnUnitCommand
  | TrainUnitCommand
  | BuildStructureCommand
  | TrainAtStructureCommand
  | ResearchTier2AtStructureCommand
  | MoveUnitCommand
  | ActivateEnergyDumpCommand
  | ResearchTrailDurationAtStructureCommand
  | BuildStructureByWorkerCommand
  | AssignWorkerToBuildCommand;

// One frame's worth of commands across both players. The sim consumes
// these in the order given, deterministically.
export interface InputFrame {
  tick: number;
  commands: Command[];
}
