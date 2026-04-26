// Replay format + Match wrapper.
//
// A replay is the input log + the seed + the version. Anyone running
// the same binary (same `version`) against the same spec + frames must
// reach the same final state hash. This is the contract that makes
// shareable replays viable, and the same property the cross-OS CI gate
// validates against committed golden fixtures.
//
// File format (JSON):
//   {
//     "version": 1,
//     "spec": InitialMatchSpec (seed must be a number, not bigint),
//     "frames": InputFrame[],
//     "finalWinner": 0 | 1 | null (optional, validated when present),
//     "finalHash": "hex string" (optional, validated when present)
//   }
//
// Match is the gameplay-facing wrapper around Sim. The renderer drives
// it with `match.step(commands)`; AI commands and player commands flow
// through the same path. Match owns the input log; replays are produced
// by `match.toReplay()`.

import { tickAi } from './ai';
import type { Command, InputFrame } from './commands';
import { Sim } from './sim';
import type { Faction } from './types';
import type { InitialMatchSpec } from './state';

export const REPLAY_VERSION = 1;

export interface ReplayLog {
  version: number;
  spec: InitialMatchSpec;
  frames: InputFrame[];
  finalWinner?: Faction | null;
  finalHash?: string;
}

export class Match {
  readonly sim: Sim;
  readonly spec: InitialMatchSpec;
  private readonly frames: InputFrame[] = [];

  constructor(spec: InitialMatchSpec) {
    if (typeof spec.seed === 'bigint') {
      // Replay JSON serialisation can't round-trip bigints in Phase 1.
      // The Rng accepts both, but Match only accepts number seeds so a
      // saved replay can be parsed back into the same spec.
      throw new Error('Match: spec.seed must be a number for replay compatibility');
    }
    this.spec = spec;
    this.sim = new Sim(spec);
  }

  // Apply a frame's worth of commands and advance one sim tick. Records
  // the frame in the input log so it can be replayed. Returns true if
  // the match concluded on this tick.
  step(commands: Command[]): boolean {
    const frame: InputFrame = { tick: this.sim.state.tick, commands };
    this.frames.push(frame);
    this.sim.step(frame);
    return this.sim.state.winner !== null;
  }

  get tick(): number {
    return this.sim.state.tick;
  }

  get winner(): Faction | null {
    return this.sim.state.winner;
  }

  toReplay(): ReplayLog {
    return {
      version: REPLAY_VERSION,
      spec: this.spec,
      frames: this.frames.slice(),
      finalWinner: this.sim.state.winner,
      finalHash: this.sim.stateHash(),
    };
  }
}

// Run a replay deterministically. Returns the final state hash and the
// per-tick hash stream (one entry per tick from tick=0 inclusive).
//
// Throws if the replay's `finalHash` is present and doesn't match the
// reproduced final hash. This is the production "did this replay drift"
// check; passing it is the property the cross-OS CI gate validates.
export interface ReplayResult {
  finalHash: string;
  hashes: string[];
  tick: number;
  winner: Faction | null;
}

export function playReplay(replay: ReplayLog): ReplayResult {
  if (replay.version !== REPLAY_VERSION) {
    throw new Error(
      `playReplay: unsupported version ${replay.version} (expected ${REPLAY_VERSION})`,
    );
  }
  const sim = new Sim(replay.spec);
  const hashes: string[] = [sim.stateHash()];
  for (const frame of replay.frames) {
    sim.step(frame);
    hashes.push(sim.stateHash());
  }
  const finalHash = sim.stateHash();
  if (replay.finalHash !== undefined && replay.finalHash !== finalHash) {
    throw new Error(
      `playReplay: final-hash mismatch (expected ${replay.finalHash}, got ${finalHash})`,
    );
  }
  if (replay.finalWinner !== undefined && replay.finalWinner !== sim.state.winner) {
    throw new Error(
      `playReplay: winner mismatch (expected ${replay.finalWinner}, got ${sim.state.winner})`,
    );
  }
  return {
    finalHash,
    hashes,
    tick: sim.state.tick,
    winner: sim.state.winner,
  };
}

export function serialiseReplay(replay: ReplayLog): string {
  return JSON.stringify(replay, null, 2);
}

export function parseReplay(json: string): ReplayLog {
  const obj = JSON.parse(json) as ReplayLog;
  if (typeof obj.version !== 'number' || obj.version !== REPLAY_VERSION) {
    throw new Error(`parseReplay: unsupported version ${obj.version}`);
  }
  if (!obj.spec || !Array.isArray(obj.frames)) {
    throw new Error('parseReplay: malformed replay (missing spec or frames)');
  }
  return obj;
}

// Convenience runner for AI-vs-AI matches: the runner concatenates AI
// commands for both factions each tick and records the result. Useful
// for generating sample replays from headless tests.
export function runAiVsAiToReplay(spec: InitialMatchSpec, maxTicks: number): Match {
  const match = new Match(spec);
  for (let t = 0; t < maxTicks && match.winner === null; t++) {
    const cmds = [...tickAi(match.sim.state, 0), ...tickAi(match.sim.state, 1)];
    match.step(cmds);
  }
  return match;
}
