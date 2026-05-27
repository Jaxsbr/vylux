// Player input commands consumed by the deterministic sim.
//
// A command is plain data — no engine references. The sim applies
// commands at the start of each tick before stepping mechanics.
//
// CommandKind IDs are append-only — a slot is never reused for a
// different command shape, even after the original command is removed.
// Removed commands keep their enum value as a reserved/dead slot;
// re-introducing a command on a slot is fine IFF the shape is the
// same. This rule keeps the wire format forward-stable across version
// bumps.

import type { Faction, ResearchKind, StructureKind } from './types';

export const enum CommandKind {
  Noop = 0,
  AssignWorkerToNode = 1,
  SpawnUnit = 2, // RESERVED — Phase A strip retired the dev-only spawn entry.
  TrainUnit = 3, // worker training at HQ.
  BuildStructure = 4, // RESERVED — Phase A strip retired this path.
  TrainAtStructure = 5, // RESERVED — Phase A strip retired non-HQ training.
  ResearchTier2 = 6, // RESERVED — pre-Phase A scaffold.
  ResearchTier2AtStructure = 7, // RESERVED — Phase A strip retired research.
  MoveUnit = 8, // manual move-order for a single unit.
  ActivateEnergyDump = 9, // RESERVED — Phase A strip retired the dump ability.
  ResearchTrailDurationAtStructure = 10, // RESERVED — Phase A strip retired research.
  BuildStructureByWorker = 11, // Phase C.1: a worker walks to the named tile and constructs a structure (currently scoped to 'workPod').
  AssignWorkerToBuild = 12, // Phase D-prep: assign a worker to FINISH an existing, partially-built structure (no new spawn, no re-paid build cost). Lets an abandoned half-built work pod be completed by any worker.
  Resign = 13, // the named faction concedes; the other faction wins. No-op if a winner is already set.
  StartResearchAtPod = 14, // Phase C.1 (post-2026-05-12): kick off a faction-level research at the named work pod. Single-slot — silently rejected if the faction is already researching or the named kind is already done.
  ScoutWorker = 15, // Phase C.6.8: send a worker to explore toward the nearest unexplored frontier tile, revealing fog en route. Auto-targets (deterministic, from the faction's explored set — no peeking at undiscovered nodes); usable by player + AI. No-op if the faction's map is fully revealed.
}

export interface NoopCommand {
  kind: CommandKind.Noop;
}

export interface AssignWorkerToNodeCommand {
  kind: CommandKind.AssignWorkerToNode;
  workerId: number;
  nodeId: number;
}

export interface TrainUnitCommand {
  kind: CommandKind.TrainUnit;
  faction: Faction;
  // Phase A: only 'worker' is valid; the type narrows accordingly.
  unitKind: 'worker';
  // Optional spawn tile. When omitted, the unit spawns on an HQ-perimeter
  // tile picked by the round-robin offset table. When provided, the unit
  // spawns at the given integer tile coords — sim does not validate
  // range; the input layer is expected to clamp to grid bounds.
  x?: number;
  y?: number;
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

export interface BuildStructureByWorkerCommand {
  kind: CommandKind.BuildStructureByWorker;
  workerId: number;
  structureKind: StructureKind;
  // Tile coords (integer). Sim does not validate position vs map
  // bounds, occupancy, or worker reach — the input layer is expected
  // to clamp + sanity-check.
  x: number;
  y: number;
}

export interface AssignWorkerToBuildCommand {
  kind: CommandKind.AssignWorkerToBuild;
  workerId: number;
  // The id of an existing, still-under-construction structure (a work pod
  // with buildTicksRemaining > 0) owned by the worker's faction. The worker
  // walks to it and ticks its build down on site — the same `building`
  // path BuildStructureByWorker uses, minus the spawn + the energy build
  // cost (already paid when the pod was first placed). Silent no-op if the
  // structure is gone, foreign, or already operational.
  structureId: number;
}

export interface ResignCommand {
  kind: CommandKind.Resign;
  faction: Faction;
}

export interface StartResearchAtPodCommand {
  kind: CommandKind.StartResearchAtPod;
  structureId: number;
  researchKind: ResearchKind;
}

export interface ScoutWorkerCommand {
  kind: CommandKind.ScoutWorker;
  workerId: number;
}

export type Command =
  | NoopCommand
  | AssignWorkerToNodeCommand
  | TrainUnitCommand
  | MoveUnitCommand
  | BuildStructureByWorkerCommand
  | AssignWorkerToBuildCommand
  | ResignCommand
  | StartResearchAtPodCommand
  | ScoutWorkerCommand;

// One frame's worth of commands across both players. The sim consumes
// these in the order given, deterministically.
export interface InputFrame {
  tick: number;
  commands: Command[];
}
