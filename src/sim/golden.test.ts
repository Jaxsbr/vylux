// Cross-machine determinism gate: a checked-in fixture of expected hashes
// that any developer's machine must reproduce.
//
// This is the persistent, portable form of the determinism contract. The
// in-process tests in sim.test.ts prove the sim is deterministic against
// itself; this file proves the sim is deterministic against the **golden
// artifact in git**. If a Windows checkout of this repo runs `npm test`
// and this test passes, we have cross-OS determinism. If it fails, the
// diff between observed and expected hashes points at the first divergent
// tick.
//
// To regenerate the fixture (after intentional sim changes):
//   RECORD_GOLDEN=1 npm test
// Then `git diff` to confirm the fixture moved as expected, and commit.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runAiVsAiMatch, runCombatMatch, runScriptedMatch } from './scripted-match';

// Two fixtures: a short match for fast feedback and a long match for the
// real determinism gate. Both checked into git. Long match equals 10
// minutes of sim at 20 Hz.
const FIXTURE_DIR = path.join(__dirname, '..', '..', 'tests', 'determinism');
const SHORT_TICKS = 200; // 10 seconds at 20 Hz
const LONG_TICKS = 12000; // 10 minutes at 20 Hz

function fixturePath(name: string): string {
  return path.join(FIXTURE_DIR, name);
}

function loadOrRecord(filePath: string, hashes: string[]): string[] {
  if (process.env.RECORD_GOLDEN === '1') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(hashes, null, 2) + '\n');
    return hashes;
  }
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Golden fixture missing: ${filePath}\nRun \`RECORD_GOLDEN=1 npm test\` to create it.`,
    );
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

describe('Sim — golden fixture (cross-machine determinism gate)', () => {
  it('reproduces the short scripted match (200 ticks)', () => {
    const hashes = runScriptedMatch(SHORT_TICKS);
    const expected = loadOrRecord(fixturePath('scripted-match-200.hashes.json'), hashes);
    expect(hashes).toEqual(expected);
    expect(hashes).toHaveLength(SHORT_TICKS + 1);
  });

  it('reproduces the long scripted match (12,000 ticks ≈ 10 min)', () => {
    const hashes = runScriptedMatch(LONG_TICKS);
    const expected = loadOrRecord(fixturePath('scripted-match-12000.hashes.json'), hashes);
    expect(hashes).toEqual(expected);
    expect(hashes).toHaveLength(LONG_TICKS + 1);
  });

  it('final-state hash matches across short / long boundary', () => {
    // Sanity: the first 200 hashes of the long log must equal the entire
    // short log. If they diverge it's a bug in `runScriptedMatch` that
    // makes its output depend on duration.
    const long = runScriptedMatch(LONG_TICKS);
    const short = runScriptedMatch(SHORT_TICKS);
    expect(long.slice(0, SHORT_TICKS + 1)).toEqual(short);
  });

  // The combat fixture exercises the Phase 1.0 sim additions:
  // Defender + Raider, range checks, cooldowns, damage, death. Long
  // enough to run combat to its conclusion (one or both units dead).
  const COMBAT_TICKS = 1500;
  it('reproduces the combat scenario (1500 ticks)', () => {
    const hashes = runCombatMatch(COMBAT_TICKS);
    const expected = loadOrRecord(fixturePath('combat-match-1500.hashes.json'), hashes);
    expect(hashes).toEqual(expected);
    expect(hashes).toHaveLength(COMBAT_TICKS + 1);
  });

  // Phase 1.1: AI-vs-AI. Both factions driven by tickAi, exercises
  // training cost-deducts, AI build order, worker assignment, and the
  // emergent combat that results when raiders march into the enemy base.
  const AI_VS_AI_TICKS = 3000;
  it('reproduces the AI-vs-AI scenario (3000 ticks)', () => {
    const hashes = runAiVsAiMatch(AI_VS_AI_TICKS);
    const expected = loadOrRecord(fixturePath('ai-vs-ai-3000.hashes.json'), hashes);
    expect(hashes).toEqual(expected);
    expect(hashes).toHaveLength(AI_VS_AI_TICKS + 1);
  });
});
