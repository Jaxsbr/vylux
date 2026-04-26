// Player input commands consumed by the deterministic sim.
//
// A command is what gets sent over the network in lockstep multiplayer:
// small, plain-data, no engine references. The sim applies commands at
// the start of each tick before stepping mechanics.
//
// Command IDs are dense small integers so the replay log can compact them
// later. Adding a command is an additive change — never reuse an ID, even
// after removal.

import type { Faction } from './types';

export const enum CommandKind {
  Noop = 0,
  AssignWorkerToNode = 1,
  SpawnWorker = 2, // dev-only entrypoint for tests; lobby uses initial state
}

export interface NoopCommand {
  kind: CommandKind.Noop;
}

export interface AssignWorkerToNodeCommand {
  kind: CommandKind.AssignWorkerToNode;
  workerId: number;
  nodeId: number;
}

export interface SpawnWorkerCommand {
  kind: CommandKind.SpawnWorker;
  faction: Faction;
  // Tile coords (will be converted to Fixed at apply time).
  x: number;
  y: number;
}

export type Command = NoopCommand | AssignWorkerToNodeCommand | SpawnWorkerCommand;

// One frame's worth of commands across both players. The sim consumes
// these in the order given, deterministically.
export interface InputFrame {
  tick: number;
  commands: Command[];
}
