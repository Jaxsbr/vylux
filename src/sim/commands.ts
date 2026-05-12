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
  AssignWorkerToBuild = 12, // RESERVED — multi-worker construction; out of scope for C.1's single-builder cut.
  Resign = 13, // the named faction concedes; the other faction wins. No-op if a winner is already set.
  StartResearchAtPod = 14, // Phase C.1 (post-2026-05-12): kick off a faction-level research at the named work pod. Single-slot — silently rejected if the faction is already researching or the named kind is already done.
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

export interface ResignCommand {
  kind: CommandKind.Resign;
  faction: Faction;
}

export interface StartResearchAtPodCommand {
  kind: CommandKind.StartResearchAtPod;
  structureId: number;
  researchKind: ResearchKind;
}

export type Command =
  | NoopCommand
  | AssignWorkerToNodeCommand
  | TrainUnitCommand
  | MoveUnitCommand
  | BuildStructureByWorkerCommand
  | ResignCommand
  | StartResearchAtPodCommand;

// One frame's worth of commands across both players. The sim consumes
// these in the order given, deterministically.
export interface InputFrame {
  tick: number;
  commands: Command[];
}
