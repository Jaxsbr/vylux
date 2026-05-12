// Replay round-trip determinism.

import { describe, expect, it } from 'vitest';
import {
  Match,
  parseReplay,
  playReplay,
  REPLAY_VERSION,
  runAiVsAiToReplay,
  serialiseReplay,
} from './replay';
import { CommandKind } from './commands';
import { AI_VS_AI_SPEC } from './scripted-match';
import type { InitialMatchSpec } from './state';

const FAST_SPEC: InitialMatchSpec = {
  seed: 1,
  hqs: { faction0: { x: 3, y: 10 }, faction1: { x: 17, y: 10 } },
  nodes: [],
  initialEnergy: 1000,
  hqMaxHp: 30,
};

describe('Match — input log + replay round-trip', () => {
  it('Match.toReplay captures every frame', () => {
    const match = new Match(FAST_SPEC);
    match.step([{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }]);
    match.step([]);
    match.step([]);
    const replay = match.toReplay();
    expect(replay.version).toBe(REPLAY_VERSION);
    expect(replay.frames).toHaveLength(3);
    expect(replay.frames[0].tick).toBe(0);
    expect(replay.frames[0].commands).toHaveLength(1);
  });

  it('replaying a recorded match reaches the same final hash', () => {
    const match = new Match(FAST_SPEC);
    // Resign on tick 0 → winner = 1 immediately.
    match.step([{ kind: CommandKind.Resign, faction: 0 }]);
    while (match.winner === null && match.tick < 200) {
      match.step([]);
    }
    expect(match.winner).toBe(1);

    const replay = match.toReplay();
    const result = playReplay(replay);
    expect(result.finalHash).toBe(replay.finalHash);
    expect(result.winner).toBe(1);
    expect(result.tick).toBe(match.tick);
  });

  it('JSON serialise + parse round-trips a replay', () => {
    const match = new Match(FAST_SPEC);
    match.step([{ kind: CommandKind.Resign, faction: 0 }]);
    for (let i = 0; i < 30 && match.winner === null; i++) match.step([]);

    const json = serialiseReplay(match.toReplay());
    const parsed = parseReplay(json);
    const result = playReplay(parsed);
    expect(result.finalHash).toBe(match.sim.stateHash());
  });

  it('playReplay throws on final-hash mismatch (tamper detection)', () => {
    const match = new Match(FAST_SPEC);
    match.step([{ kind: CommandKind.Resign, faction: 0 }]);
    for (let i = 0; i < 10; i++) match.step([]);

    const replay = match.toReplay();
    replay.finalHash = 'deadbeefdeadbeef';
    expect(() => playReplay(replay)).toThrow(/final-hash mismatch/);
  });

  it('playReplay throws on winner mismatch', () => {
    const match = new Match(FAST_SPEC);
    match.step([{ kind: CommandKind.Resign, faction: 0 }]);
    for (let i = 0; i < 50 && match.winner === null; i++) match.step([]);

    const replay = match.toReplay();
    replay.finalWinner = 0; // wrong (resigning faction was 0, so winner is 1)
    expect(() => playReplay(replay)).toThrow(/winner mismatch/);
  });

  it('parseReplay rejects unsupported versions', () => {
    expect(() => parseReplay('{"version": 99}')).toThrow(/unsupported version/);
  });

  it('Match rejects bigint seeds (replay JSON cannot encode them)', () => {
    expect(() => new Match({ ...FAST_SPEC, seed: 1n })).toThrow(/seed must be a number/);
  });
});

describe('Match — AI replay round-trip', () => {
  it('AI-vs-AI match recorded and replayed deterministically', () => {
    const match = runAiVsAiToReplay(AI_VS_AI_SPEC, 1000);
    const replay = match.toReplay();
    const result = playReplay(replay);
    expect(result.finalHash).toBe(match.sim.stateHash());
    expect(result.winner).toBe(match.winner);
    expect(result.hashes).toHaveLength(replay.frames.length + 1);
  });

  it('JSON-serialised AI replay reproduces the same final state', () => {
    const match = runAiVsAiToReplay(AI_VS_AI_SPEC, 800);
    const json = serialiseReplay(match.toReplay());
    const parsed = parseReplay(json);
    const result = playReplay(parsed);
    expect(result.finalHash).toBe(match.sim.stateHash());
  });
});
