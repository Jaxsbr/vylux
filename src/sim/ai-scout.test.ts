// Phase C.6.10 — AI scouting / no-economic-stall guard.
//
// C.6.5's bigger 64² randomised map exposed the stall: the AI only routes to
// DISCOVERED nodes, so once it drains the patch near its corner HQ it has no
// discovered live node left and freezes (stops harvesting, never expands).
// C.6.10 fixes that by dispatching stalled workers to scout — they reveal fog,
// uncover fresh nodes, and autoAssign then harvests them. This test runs a
// long AI-vs-AI match on the REAL map (the live seed-42 field, HQs in opposite
// corners) and asserts the AI keeps discovering ground instead of stalling.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { tickAi } from './ai';
import { generateEnergyField } from './map-gen';
import type { InitialMatchSpec, } from './state';

// Mirrors src/main.ts's live normal-match SPEC.
const HQ0 = { x: 8, y: 55 };
const HQ1 = { x: 55, y: 8 };
const GRID = 64;

function realisticSpec(seed: number): InitialMatchSpec {
  return {
    seed,
    gridSize: GRID,
    hqs: { faction0: HQ0, faction1: HQ1 },
    nodes: generateEnergyField({
      seed,
      gridSize: GRID,
      hqs: [HQ0, HQ1],
      count: 16,
      hqVisionRadiusTiles: 8,
    }),
    initialEnergy: 200,
    hqMaxHp: 250,
  };
}

function discoveredNodeCount(sim: Sim, faction: 0 | 1): number {
  let n = 0;
  for (const node of sim.state.nodes) if (node.discoveredBy[faction]) n += 1;
  return n;
}

function exploredTileCount(sim: Sim, faction: 0 | 1): number {
  const e = sim.state.explored[faction];
  let n = 0;
  for (let i = 0; i < e.length; i++) n += e[i];
  return n;
}

describe('Phase C.6.10 — AI scouting (no economic stall)', () => {
  it('scouts out from its home patch and keeps discovering nodes on the 64² map', () => {
    const sim = new Sim(realisticSpec(42));
    const discoveredStart: [number, number] = [discoveredNodeCount(sim, 0), discoveredNodeCount(sim, 1)];
    const exploredStart: [number, number] = [exploredTileCount(sim, 0), exploredTileCount(sim, 1)];
    const sawScouting: [boolean, boolean] = [false, false];

    const TICKS = 9000; // 7.5 min at 20 Hz — well past local-patch depletion
    for (let t = 0; t < TICKS; t++) {
      const cmds = [...tickAi(sim.state, 0), ...tickAi(sim.state, 1)];
      sim.step({ tick: t, commands: cmds });
      if (!sawScouting[0] || !sawScouting[1]) {
        for (const u of sim.state.units) {
          if (u.alive && u.kind === 'worker' && u.phase === 'scouting') {
            sawScouting[u.faction] = true;
          }
        }
      }
    }

    // Eco-only match (no combat units), so the HQs are never attacked.
    expect(sim.state.winner).toBeNull();

    for (const f of [0, 1] as const) {
      // The AI actually dispatched scouts (the trigger fired).
      expect(sawScouting[f]).toBe(true);
      // Scouting revealed new ground beyond the opening HQ vision.
      expect(exploredTileCount(sim, f)).toBeGreaterThan(exploredStart[f]);
      // The stall fix in one assertion: the discovered-node count climbs, so
      // autoAssign always has fresh harvest targets — the AI never runs out.
      expect(discoveredNodeCount(sim, f)).toBeGreaterThan(discoveredStart[f]);
    }
  });
});
