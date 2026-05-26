// Phase C.6.8 — scout order primitive.
//
// The scout order is a pure function of sim state: it auto-targets the
// nearest UNEXPLORED tile from the faction's explored set (never reading
// node positions), reveals fog as the worker walks, and terminates when the
// faction's map is fully revealed. These tests pin that contract.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { applyCommand } from './step';
import { CommandKind } from './commands';
import { findWorker, spawnUnit, type InitialMatchSpec } from './state';
import { fromInt, toInt } from './fixed';
import { WORKER_DEFAULT_MAX_CHARGE } from './units-config';

// A grid bigger than the HQ vision radius so there is genuine fog to scout
// into. HQ in a corner; one node parked far away (its position must never
// influence target selection).
const SPEC: InitialMatchSpec = {
  seed: 7,
  gridSize: 32,
  hqs: { faction0: { x: 2, y: 2 }, faction1: { x: 29, y: 29 } },
  nodes: [{ x: 20, y: 20, energy: 100 }],
  initialEnergy: 0,
};

function exploredCount(sim: Sim, faction: 0 | 1): number {
  const e = sim.state.explored[faction];
  let n = 0;
  for (let i = 0; i < e.length; i++) n += e[i];
  return n;
}

describe('Phase C.6.8 — scout order', () => {
  it('enters the scouting phase, sets a frontier target, and drains one charge', () => {
    const sim = new Sim(SPEC);
    const w = spawnUnit(sim.state, 'worker', 0, fromInt(2), fromInt(2));
    expect(w.charge).toBe(WORKER_DEFAULT_MAX_CHARGE);

    applyCommand(sim.state, { kind: CommandKind.ScoutWorker, workerId: w.id });

    const after = findWorker(sim.state, w.id)!;
    expect(after.phase).toBe('scouting');
    expect(after.moveTarget).not.toBeNull();
    expect(after.charge).toBe(WORKER_DEFAULT_MAX_CHARGE - 1);
  });

  it('targets an UNEXPLORED tile (no peeking under the fog)', () => {
    const sim = new Sim(SPEC);
    const w = spawnUnit(sim.state, 'worker', 0, fromInt(2), fromInt(2));

    applyCommand(sim.state, { kind: CommandKind.ScoutWorker, workerId: w.id });

    const mt = findWorker(sim.state, w.id)!.moveTarget!;
    const idx = toInt(mt.y) * sim.state.gridSize + toInt(mt.x);
    expect(sim.state.explored[0][idx]).toBe(0);
  });

  it('selects the same target from the same state (pure function)', () => {
    const a = new Sim(SPEC);
    const wa = spawnUnit(a.state, 'worker', 0, fromInt(2), fromInt(2));
    applyCommand(a.state, { kind: CommandKind.ScoutWorker, workerId: wa.id });

    const b = new Sim(SPEC);
    const wb = spawnUnit(b.state, 'worker', 0, fromInt(2), fromInt(2));
    applyCommand(b.state, { kind: CommandKind.ScoutWorker, workerId: wb.id });

    expect(findWorker(a.state, wa.id)!.moveTarget).toEqual(findWorker(b.state, wb.id)!.moveTarget);
  });

  it('reveals new fog as it scouts', () => {
    const sim = new Sim(SPEC);
    const w = spawnUnit(sim.state, 'worker', 0, fromInt(2), fromInt(2));
    const before = exploredCount(sim, 0);

    sim.step({ tick: 0, commands: [{ kind: CommandKind.ScoutWorker, workerId: w.id }] });
    for (let t = 1; t < 400; t++) sim.step({ tick: t, commands: [] });

    expect(exploredCount(sim, 0)).toBeGreaterThan(before);
  });

  it('is a no-op when the faction map is already fully revealed', () => {
    const sim = new Sim(SPEC);
    const w = spawnUnit(sim.state, 'worker', 0, fromInt(2), fromInt(2));
    sim.state.explored[0].fill(1);

    applyCommand(sim.state, { kind: CommandKind.ScoutWorker, workerId: w.id });

    const after = findWorker(sim.state, w.id)!;
    expect(after.phase).toBe('idle');
    expect(after.charge).toBe(WORKER_DEFAULT_MAX_CHARGE);
  });
});
