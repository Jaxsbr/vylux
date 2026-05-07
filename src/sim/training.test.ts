// TrainUnit + AI determinism for Phase 1.1.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { CommandKind } from './commands';
import { autoAssignIdleWorkers, tickAi } from './ai';
import { UNIT_STATS } from './units-config';
import type { InitialMatchSpec } from './state';
import type { ProductionBuilding, Structure } from './types';

// Tests built before 3.2 assumed all structures were production
// buildings. With UpgradeStructure now in the union, accessing
// production-only fields (trainingKind / trainTicksRemaining) requires
// narrowing. Test fixtures only spawn production buildings, so a
// runtime assertion here is enough.
function asProduction(s: Structure): ProductionBuilding {
  if (s.kind !== 'production') {
    throw new Error(`test expected production structure, got ${s.kind}`);
  }
  return s;
}

const TRAIN_SPEC: InitialMatchSpec = {
  seed: 1,
  hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
  nodes: [],
  initialEnergy: 1000,
  // Phase 3.5: pre-fund colour generously so the existing 3.0–3.2
  // tests keep passing without a per-test colour-pre-fund. Tests that
  // specifically exercise the colour-lockout path build their own spec
  // with a controlled initialColor.
  initialColor: 1000,
};

describe('Sim — training', () => {
  it('TrainUnit deducts energy and spawns near HQ perimeter', () => {
    // Phase 3.10.4: workers spawn at one of the HQ_PERIMETER_OFFSETS
    // tiles, not on the HQ tile itself. The offset is deterministic
    // (round-robin via faction.nextSpawnRotation) so we can predict
    // it: the first spawn uses index 0 = (+2, 0).
    const sim = new Sim(TRAIN_SPEC);
    const before = sim.state.factions[0].energy;
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
    });
    const after = sim.state.factions[0].energy;
    expect(after).toBe(before - UNIT_STATS.worker.trainCost);

    const trained = sim.state.units.find((u) => u.kind === 'worker' && u.faction === 0);
    expect(trained).toBeTruthy();
    // First perimeter offset is (+2, 0). HQ at (3, 3) → spawn at (5, 3).
    expect(trained!.x).toBe((3 + 2) * 65536);
    expect(trained!.y).toBe(3 * 65536);
  });

  it('TrainUnit silently rejects when underfunded', () => {
    const sim = new Sim({ ...TRAIN_SPEC, initialEnergy: 10 });
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
    });
    // No unit trained, energy unchanged (10 in Q16.16 = 10 * 65536).
    expect(sim.state.units.length).toBe(0);
    expect(sim.state.factions[0].energy).toBe(10 * 65536);
  });

  it('TrainUnit accumulates spawns over multiple ticks', () => {
    const sim = new Sim(TRAIN_SPEC);
    for (let t = 0; t < 5; t++) {
      sim.step({
        tick: t,
        commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
      });
    }
    const owned = sim.state.units.filter((u) => u.faction === 0 && u.alive);
    expect(owned).toHaveLength(5);
  });

  it('TrainUnit with tile coords spawns at the given tile, not at HQ', () => {
    const sim = new Sim(TRAIN_SPEC);
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker', x: 7, y: 9 },
      ],
    });
    const w = sim.state.units.find((u) => u.kind === 'worker' && u.faction === 0);
    expect(w).toBeTruthy();
    // Compare in fixed-point: tile 7 = 7 << 16.
    expect(w!.x).toBe(7 * 65536);
    expect(w!.y).toBe(9 * 65536);
  });

  it('TrainUnit without tile coords spawns at HQ perimeter (Phase 3.10.4)', () => {
    const sim = new Sim(TRAIN_SPEC);
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
    });
    const w = sim.state.units.find((u) => u.kind === 'worker' && u.faction === 0);
    // First perimeter offset is (+2, 0). HQ at (3, 3).
    expect(w!.x).toBe((3 + 2) * 65536);
    expect(w!.y).toBe(3 * 65536);
  });

  it('TrainUnit silently rejects combat unitKinds — Phase 3.0 HQ trains workers only', () => {
    const sim = new Sim(TRAIN_SPEC);
    const before = sim.state.factions[0].energy;
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.TrainUnit, faction: 0, unitKind: 'defender' },
        { kind: CommandKind.TrainUnit, faction: 0, unitKind: 'raider' },
      ],
    });
    expect(sim.state.units.length).toBe(0);
    expect(sim.state.factions[0].energy).toBe(before);
  });
});

describe('Sim — structures (Phase 3.0)', () => {
  it('BuildStructure deducts cost, spawns a building under construction', () => {
    const sim = new Sim(TRAIN_SPEC);
    const before = sim.state.factions[0].energy;
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'production', x: 5, y: 5 },
      ],
    });
    expect(sim.state.structures).toHaveLength(1);
    const s = asProduction(sim.state.structures[0]);
    expect(s.faction).toBe(0);
    expect(s.kind).toBe('production');
    expect(s.alive).toBe(true);
    expect(s.buildTicksRemaining).toBeGreaterThan(0);
    expect(sim.state.factions[0].energy).toBeLessThan(before);
  });

  it('BuildStructure silently rejects when underfunded', () => {
    const sim = new Sim({ ...TRAIN_SPEC, initialEnergy: 10 });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'production', x: 5, y: 5 },
      ],
    });
    expect(sim.state.structures).toHaveLength(0);
  });

  it('production building counts down build ticks each step until operational', () => {
    const sim = new Sim(TRAIN_SPEC);
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'production', x: 5, y: 5 },
      ],
    });
    const s = asProduction(sim.state.structures[0]);
    const startBuild = s.buildTicksRemaining;
    expect(startBuild).toBeGreaterThan(0);

    // Step until operational. Each tick decrements by 1.
    for (let t = 1; t <= startBuild; t++) {
      sim.step({ tick: t, commands: [] });
    }
    expect(s.buildTicksRemaining).toBe(0);
  });

  it('TrainAtStructure rejects on a still-building structure', () => {
    const sim = new Sim(TRAIN_SPEC);
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'production', x: 5, y: 5 },
      ],
    });
    const s = asProduction(sim.state.structures[0]);
    const energyBefore = sim.state.factions[0].energy;
    sim.step({
      tick: 1,
      commands: [
        { kind: CommandKind.TrainAtStructure, structureId: s.id, unitKind: 'defender' },
      ],
    });
    expect(s.trainingKind).toBeNull();
    expect(sim.state.factions[0].energy).toBe(energyBefore);
  });

  it('TrainAtStructure on operational building spawns the unit at the structure tile', () => {
    const sim = new Sim(TRAIN_SPEC);
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'production', x: 5, y: 5 },
      ],
    });
    const s = asProduction(sim.state.structures[0]);
    // Snapshot the bound — buildTicksRemaining decrements each step,
    // so re-evaluating it as the loop condition would cut the loop in
    // half (t advances while the bound shrinks).
    const buildSteps = s.buildTicksRemaining;
    for (let t = 1; t <= buildSteps; t++) {
      sim.step({ tick: t, commands: [] });
    }
    expect(s.buildTicksRemaining).toBe(0);

    // Issue a training command. Step out the train phase.
    const trainStartTick = sim.state.tick;
    sim.step({
      tick: trainStartTick,
      commands: [
        { kind: CommandKind.TrainAtStructure, structureId: s.id, unitKind: 'defender' },
      ],
    });
    expect(s.trainingKind).toBe('defender');
    const trainTicks = s.trainTicksRemaining;
    expect(trainTicks).toBeGreaterThan(0);

    for (let i = 0; i < trainTicks; i++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(s.trainingKind).toBeNull();
    const defender = sim.state.units.find((u) => u.kind === 'defender' && u.faction === 0);
    expect(defender).toBeTruthy();
    expect(defender!.x).toBe(5 * 65536);
    expect(defender!.y).toBe(5 * 65536);
  });

  it('TrainAtStructure rejects when single-slot queue is busy', () => {
    const sim = new Sim(TRAIN_SPEC);
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'production', x: 5, y: 5 },
      ],
    });
    const s = asProduction(sim.state.structures[0]);
    const buildSteps = s.buildTicksRemaining;
    for (let t = 1; t <= buildSteps; t++) {
      sim.step({ tick: t, commands: [] });
    }
    sim.step({
      tick: sim.state.tick,
      commands: [
        { kind: CommandKind.TrainAtStructure, structureId: s.id, unitKind: 'defender' },
      ],
    });
    expect(s.trainingKind).toBe('defender');
    const energyAfterFirst = sim.state.factions[0].energy;

    // Second training command on the same structure while still busy → rejected.
    sim.step({
      tick: sim.state.tick,
      commands: [
        { kind: CommandKind.TrainAtStructure, structureId: s.id, unitKind: 'raider' },
      ],
    });
    expect(s.trainingKind).toBe('defender'); // unchanged
    expect(sim.state.factions[0].energy).toBe(energyAfterFirst); // no extra cost
  });

  it('Phase 3.1: worker harvests Flux node and deposits to faction.flux, not faction.energy', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      // Single Flux node within easy harvest reach. No energy nodes —
      // forces the worker onto Flux.
      nodes: [{ x: 4, y: 4, energy: 100, kind: 'flux' }],
      initialEnergy: 100,
    });
    // Spawn a worker right next to the Flux node so the test doesn't
    // wait for travel time.
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 4, y: 4 },
      ],
    });
    const w = sim.state.units[0]!;
    expect(w.kind).toBe('worker');
    if (w.kind !== 'worker') throw new Error('worker not spawned'); // type narrowing

    const fluxNodeId = sim.state.nodes[0].id;
    const energyBefore = sim.state.factions[0].energy;
    const fluxBefore = sim.state.factions[0].flux;

    // Send the worker to harvest the Flux node.
    sim.step({
      tick: 1,
      commands: [
        { kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId: fluxNodeId },
      ],
    });

    // Run long enough for: walk to node, harvest 20 ticks, walk back,
    // deposit. Worker speed is 0.05 tile/tick; the node is right next
    // to the spawn point so travel is short. 200 ticks is plenty.
    for (let t = 0; t < 200; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      if (sim.state.factions[0].flux > fluxBefore) break;
    }

    expect(sim.state.factions[0].flux).toBeGreaterThan(fluxBefore);
    // Energy must NOT have moved — Flux deposit goes to its own pool.
    expect(sim.state.factions[0].energy).toBe(energyBefore);
  });

  // Phase 3.2 replaces 3.1's standalone ResearchTier2 with a
  // structure-gated flow: build a Spire, then issue
  // ResearchTier2AtStructure against it, then wait for the research
  // ticks to complete. The 3.1 tests are deleted; their concerns
  // (deduction, idempotency, rejection-when-underfunded) are tested
  // through the new path below.

  it('Phase 3.2: BuildStructure(upgrade) deducts upgrade cost and spawns a Spire', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [],
      initialEnergy: 1000,
      initialColor: 1000,
    });
    const energyBefore = sim.state.factions[0].energy;
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'upgrade', x: 4, y: 3 },
      ],
    });
    expect(sim.state.structures).toHaveLength(1);
    const s = sim.state.structures[0];
    expect(s.kind).toBe('upgrade');
    expect(s.alive).toBe(true);
    expect(s.buildTicksRemaining).toBeGreaterThan(0);
    expect(sim.state.factions[0].energy).toBeLessThan(energyBefore);
  });

  it('Phase 3.2: ResearchTier2AtStructure on still-building Spire is silently rejected', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [],
      initialEnergy: 1000,
      initialFlux: 100,
      initialColor: 1000,
    });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'upgrade', x: 4, y: 3 },
      ],
    });
    const s = sim.state.structures[0];
    if (s.kind !== 'upgrade') throw new Error('unexpected structure kind');
    const fluxBefore = sim.state.factions[0].flux;
    sim.step({
      tick: 1,
      commands: [
        { kind: CommandKind.ResearchTier2AtStructure, structureId: s.id },
      ],
    });
    expect(s.researchTicksRemaining).toBe(0);
    expect(sim.state.factions[0].flux).toBe(fluxBefore); // no deduct
    expect(sim.state.factions[0].tier2Researched).toBe(false);
  });

  it('Phase 3.2: research completes after researchTicks and sets faction.tier2Researched', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [],
      initialEnergy: 1000,
      initialFlux: 100,
      initialColor: 1000,
    });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'upgrade', x: 4, y: 3 },
      ],
    });
    const s = sim.state.structures[0];
    if (s.kind !== 'upgrade') throw new Error('unexpected structure kind');

    // Wait out the build phase.
    const buildSteps = s.buildTicksRemaining;
    for (let t = 1; t <= buildSteps; t++) sim.step({ tick: t, commands: [] });
    expect(s.buildTicksRemaining).toBe(0);

    // Issue research.
    const fluxBefore = sim.state.factions[0].flux;
    sim.step({
      tick: sim.state.tick,
      commands: [
        { kind: CommandKind.ResearchTier2AtStructure, structureId: s.id },
      ],
    });
    expect(s.researchTicksRemaining).toBeGreaterThan(0);
    expect(sim.state.factions[0].flux).toBeLessThan(fluxBefore);
    expect(sim.state.factions[0].tier2Researched).toBe(false); // not yet

    // Wait out research.
    const researchSteps = s.researchTicksRemaining;
    for (let i = 0; i < researchSteps; i++) sim.step({ tick: sim.state.tick, commands: [] });
    expect(s.researchTicksRemaining).toBe(0);
    expect(sim.state.factions[0].tier2Researched).toBe(true);
  });

  it('Phase 3.2: vanguard training is rejected pre-research; succeeds post-research and deducts both pools', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [],
      initialEnergy: 5000,
      initialFlux: 200,
      initialColor: 1000,
    });
    // Build a Forge to host vanguard production.
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'production', x: 5, y: 5 },
      ],
    });
    const forge = asProduction(sim.state.structures[0]);
    const buildForge = forge.buildTicksRemaining;
    for (let t = 1; t <= buildForge; t++) sim.step({ tick: t, commands: [] });

    // Pre-research: vanguard training rejected.
    const energyBeforeReject = sim.state.factions[0].energy;
    const fluxBeforeReject = sim.state.factions[0].flux;
    sim.step({
      tick: sim.state.tick,
      commands: [
        { kind: CommandKind.TrainAtStructure, structureId: forge.id, unitKind: 'vanguard' },
      ],
    });
    expect(forge.trainingKind).toBeNull();
    expect(sim.state.factions[0].energy).toBe(energyBeforeReject);
    expect(sim.state.factions[0].flux).toBe(fluxBeforeReject);

    // Cheat the flag for this test (the structure-gated path is
    // covered above; here we want to isolate the train-time gate).
    sim.state.factions[0].tier2Researched = true;

    sim.step({
      tick: sim.state.tick,
      commands: [
        { kind: CommandKind.TrainAtStructure, structureId: forge.id, unitKind: 'vanguard' },
      ],
    });
    expect(forge.trainingKind).toBe('vanguard');
    expect(sim.state.factions[0].energy).toBeLessThan(energyBeforeReject);
    expect(sim.state.factions[0].flux).toBeLessThan(fluxBeforeReject);
  });

  it('Phase 3.5: own-colour worker harvests and deposits to faction.color (not energy / not flux)', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      // Single Blue node next to faction-0 HQ. No other nodes — forces
      // the worker onto Blue.
      nodes: [{ x: 4, y: 4, energy: 100, kind: 'blue' }],
      initialEnergy: 100,
    });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 4, y: 4 },
      ],
    });
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    const nodeId = sim.state.nodes[0].id;

    const energyBefore = sim.state.factions[0].energy;
    const fluxBefore = sim.state.factions[0].flux;
    const colorBefore = sim.state.factions[0].color;
    sim.step({
      tick: 1,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId }],
    });
    for (let t = 0; t < 200; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      if (sim.state.factions[0].color > colorBefore) break;
    }
    expect(sim.state.factions[0].color).toBeGreaterThan(colorBefore);
    expect(sim.state.factions[0].energy).toBe(energyBefore);
    expect(sim.state.factions[0].flux).toBe(fluxBefore);
  });

  it('Phase 3.5: AssignWorkerToNode is silently rejected for the opponent colour', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      // A single Red node — illegal for faction-0 to harvest.
      nodes: [{ x: 4, y: 4, energy: 100, kind: 'red' }],
      initialEnergy: 100,
    });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 4, y: 4 },
      ],
    });
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    const nodeId = sim.state.nodes[0].id;

    sim.step({
      tick: 1,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId }],
    });
    // Worker stays idle; no target was set.
    expect(w.phase).toBe('idle');
    expect(w.targetNodeId).toBe(0);
  });

  it('Phase 3.5: colour nodes regenerate toward maxReserve and cap there', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [{ x: 4, y: 4, energy: 0, kind: 'blue' }], // start fully depleted
    });
    const node = sim.state.nodes[0];
    expect(node.remaining).toBe(0);
    expect(node.maxReserve).toBeGreaterThan(0);
    expect(node.regenPerTick).toBeGreaterThan(0);

    // Tick forward; remaining should grow but never exceed maxReserve.
    for (let t = 0; t < 5000; t++) sim.step({ tick: sim.state.tick, commands: [] });
    expect(node.remaining).toBeGreaterThan(0);
    expect(node.remaining).toBeLessThanOrEqual(node.maxReserve);

    // After enough ticks (maxReserve / regenPerTick), the cap is reached.
    const ticksToCap = Math.ceil(node.maxReserve / node.regenPerTick);
    for (let t = 0; t < ticksToCap + 10; t++) sim.step({ tick: sim.state.tick, commands: [] });
    expect(node.remaining).toBe(node.maxReserve);
  });

  it('Phase 3.5: depleted colour nodes do NOT die (energy/flux still die at empty)', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [
        { x: 4, y: 4, energy: 5, kind: 'blue' }, // small colour reserve
        { x: 5, y: 5, energy: 5, kind: 'energy' }, // small energy reserve
      ],
      initialEnergy: 100,
    });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 4, y: 4 },
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 5, y: 5 },
      ],
    });
    const blueNodeId = sim.state.nodes[0].id;
    const energyNodeId = sim.state.nodes[1].id;
    sim.step({
      tick: 1,
      commands: [
        { kind: CommandKind.AssignWorkerToNode, workerId: 3, nodeId: blueNodeId },
        { kind: CommandKind.AssignWorkerToNode, workerId: 4, nodeId: energyNodeId },
      ],
    });
    for (let t = 0; t < 200; t++) sim.step({ tick: sim.state.tick, commands: [] });
    // Energy node consumed → dead.
    expect(sim.state.nodes[1].alive).toBe(false);
    // Blue node consumed → still alive (regen brings it back).
    expect(sim.state.nodes[0].alive).toBe(true);
  });

  it('Phase 3.5: TrainUnit at HQ is silently rejected when color is insufficient', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [],
      initialEnergy: 1000,
      initialColor: 0, // explicit lockout
    });
    const energyBefore = sim.state.factions[0].energy;
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
    });
    expect(sim.state.units.length).toBe(0);
    expect(sim.state.factions[0].energy).toBe(energyBefore);
  });

  it('Phase 3.5: BuildStructure + TrainAtStructure + ResearchTier2 all gate on color', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [],
      initialEnergy: 5000,
      initialFlux: 200,
      initialColor: 30, // exactly enough for one Forge (30), nothing else
    });
    // Forge: 30 colour. Should succeed and zero out the colour pool.
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'production', x: 5, y: 5 },
      ],
    });
    expect(sim.state.structures).toHaveLength(1);
    expect(sim.state.factions[0].color).toBe(0);

    // Spire: 25 colour cost, but pool is 0 — silently rejected.
    sim.step({
      tick: 1,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'upgrade', x: 4, y: 5 },
      ],
    });
    expect(sim.state.structures).toHaveLength(1); // no Spire spawned

    // Wait for Forge to finish building. Then try to train a defender
    // at it — colour-locked so silently rejected.
    const forge = sim.state.structures[0];
    if (forge.kind !== 'production') throw new Error('expected production');
    for (let t = 1; t <= forge.buildTicksRemaining + 1; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    sim.step({
      tick: sim.state.tick,
      commands: [
        { kind: CommandKind.TrainAtStructure, structureId: forge.id, unitKind: 'defender' },
      ],
    });
    expect(forge.trainingKind).toBeNull();

    // Pre-fund colour, build a Spire, wait for it, then try research —
    // Tier-2 also gates on colour. Top up colour to 25 (just enough for
    // Spire) — research will then fail because pool is 0 again after.
    sim.state.factions[0].color = 25 << 16; // hack-pre-fund
    sim.step({
      tick: sim.state.tick,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'upgrade', x: 4, y: 5 },
      ],
    });
    expect(sim.state.structures).toHaveLength(2);
    const spire = sim.state.structures[1];
    if (spire.kind !== 'upgrade') throw new Error('expected upgrade');
    for (let t = 1; t <= spire.buildTicksRemaining + 1; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(sim.state.factions[0].color).toBe(0);
    sim.step({
      tick: sim.state.tick,
      commands: [
        { kind: CommandKind.ResearchTier2AtStructure, structureId: spire.id },
      ],
    });
    expect(spire.researchTicksRemaining).toBe(0);
    expect(sim.state.factions[0].tier2Researched).toBe(false);
  });

  it('Phase 3.6: spawnUnit + applyDamage track supplyUsed', () => {
    const sim = new Sim(TRAIN_SPEC);
    expect(sim.state.factions[0].supplyUsed).toBe(0);
    sim.step({
      tick: 0,
      commands: [
        // Worker (1) + raider (2) + defender (2) = 5 supply.
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 5, y: 5 },
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 0, x: 6, y: 5 },
        { kind: CommandKind.SpawnUnit, unitKind: 'defender', faction: 0, x: 7, y: 5 },
      ],
    });
    expect(sim.state.factions[0].supplyUsed).toBe(5);

    // Kill the worker via a faction-1 raider next to it. Worker has
    // 40 HP, raider damage 15, cooldown 15 ticks → ~3 hits.
    sim.step({
      tick: 1,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 1, x: 5, y: 5 },
      ],
    });
    expect(sim.state.factions[1].supplyUsed).toBe(2);

    for (let t = 0; t < 200; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      const w = sim.state.units.find((u) => u.kind === 'worker');
      if (w && !w.alive) break;
    }
    // Worker died → faction-0 supplyUsed drops by 1 (worker cost).
    // The defender (still alive, supply 2) + raider (still alive, supply 2)
    // remain → supplyUsed is now 4.
    expect(sim.state.factions[0].supplyUsed).toBe(4);
  });

  it('Phase 3.6: TrainUnit at HQ silently rejected at supply cap', () => {
    const sim = new Sim(TRAIN_SPEC);
    // Hack faction 0 to be exactly at cap.
    sim.state.factions[0].supplyUsed = sim.state.factions[0].supplyCap;
    const energyBefore = sim.state.factions[0].energy;
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' }],
    });
    expect(sim.state.units.length).toBe(0);
    expect(sim.state.factions[0].energy).toBe(energyBefore);
  });

  it('Phase 3.6: TrainAtStructure silently rejected at supply cap (reserves at queue time)', () => {
    const sim = new Sim(TRAIN_SPEC);
    // Build + finish a Forge so we can queue training at it.
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'production', x: 5, y: 5 },
      ],
    });
    const s = asProduction(sim.state.structures[0]);
    const buildSteps = s.buildTicksRemaining;
    for (let t = 1; t <= buildSteps + 1; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    // Hack faction 0 close to cap (supplyCap=10, leave 1 free; raider needs 2).
    sim.state.factions[0].supplyUsed = sim.state.factions[0].supplyCap - 1;
    const energyBefore = sim.state.factions[0].energy;
    sim.step({
      tick: sim.state.tick,
      commands: [
        { kind: CommandKind.TrainAtStructure, structureId: s.id, unitKind: 'raider' },
      ],
    });
    expect(s.trainingKind).toBeNull();
    expect(sim.state.factions[0].energy).toBe(energyBefore);
    // Now leave 2 free — raider should queue.
    sim.state.factions[0].supplyUsed = sim.state.factions[0].supplyCap - 2;
    sim.step({
      tick: sim.state.tick,
      commands: [
        { kind: CommandKind.TrainAtStructure, structureId: s.id, unitKind: 'raider' },
      ],
    });
    expect(s.trainingKind).toBe('raider');
    // Reservation: supplyUsed should already include the queued raider.
    expect(sim.state.factions[0].supplyUsed).toBe(sim.state.factions[0].supplyCap);
  });

  it('Phase 3.6: building a Pylon raises supplyCap by 8 once operational', () => {
    const sim = new Sim(TRAIN_SPEC);
    expect(sim.state.factions[0].supplyCap).toBe(10);
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'supply', x: 5, y: 5 },
      ],
    });
    const pylon = sim.state.structures[0];
    expect(pylon.kind).toBe('supply');
    // Cap unchanged while still building.
    expect(sim.state.factions[0].supplyCap).toBe(10);
    // Tick out the build phase. Snapshot the bound — buildTicksRemaining
    // decrements each step, so re-evaluating it as the loop condition
    // would meet the loop counter halfway.
    const buildSteps = pylon.buildTicksRemaining;
    for (let t = 1; t <= buildSteps + 1; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(pylon.buildTicksRemaining).toBe(0);
    expect(sim.state.factions[0].supplyCap).toBe(18);
  });

  it('Phase 3.6: killing a Pylon drops supplyCap; alive units are not retroactively killed', () => {
    const sim = new Sim(TRAIN_SPEC);
    // Build a Pylon, wait for it, then a couple of units.
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'supply', x: 5, y: 5 },
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 0, x: 6, y: 6 },
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 0, x: 7, y: 6 },
      ],
    });
    const pylon = sim.state.structures[0];
    const buildSteps = pylon.buildTicksRemaining;
    for (let t = 1; t <= buildSteps + 1; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(sim.state.factions[0].supplyCap).toBe(18);
    expect(sim.state.factions[0].supplyUsed).toBe(4); // 2 raiders × 2 supply

    // Hack-kill the Pylon and step once so end-of-step recompute fires.
    pylon.alive = false;
    pylon.hp = 0;
    sim.step({ tick: sim.state.tick, commands: [] });
    expect(sim.state.factions[0].supplyCap).toBe(10);
    // Existing units stay alive — supplyUsed unchanged.
    expect(sim.state.factions[0].supplyUsed).toBe(4);
    // Live raiders still in the units list, alive flags intact.
    const liveCount = sim.state.units.filter((u) => u.alive).length;
    expect(liveCount).toBe(2);
  });

  it('Phase 3.7: ActivateEnergyDump deducts energy + sets dumpTicksRemaining + spawns trail', () => {
    const sim = new Sim(TRAIN_SPEC);
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 5, y: 5 },
      ],
    });
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    const energyBefore = sim.state.factions[0].energy;
    sim.step({
      tick: 1,
      commands: [{ kind: CommandKind.ActivateEnergyDump, workerId: w.id }],
    });
    expect(sim.state.factions[0].energy).toBe(energyBefore - 100 * 65536);
    expect(w.dumpTicksRemaining).toBeGreaterThan(0);
    expect(w.activeTrailId).toBeGreaterThan(0);
    expect(sim.state.trails).toHaveLength(1);
    expect(sim.state.trails[0].ownerFaction).toBe(0);
  });

  it('Phase 3.7: ActivateEnergyDump silently rejected when energy insufficient / already dumping / on cooldown', () => {
    const sim = new Sim({ ...TRAIN_SPEC, initialEnergy: 50 }); // < 100 dump cost
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 5, y: 5 },
      ],
    });
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    sim.step({
      tick: 1,
      commands: [{ kind: CommandKind.ActivateEnergyDump, workerId: w.id }],
    });
    expect(w.dumpTicksRemaining).toBe(0);
    expect(sim.state.trails).toHaveLength(0);

    // Now with enough energy: succeeds. Re-issuing while still
    // dumping is silently rejected (no second trail).
    const sim2 = new Sim(TRAIN_SPEC);
    sim2.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 5, y: 5 },
      ],
    });
    const w2 = sim2.state.units[0];
    if (w2.kind !== 'worker') throw new Error('expected worker');
    sim2.step({
      tick: 1,
      commands: [{ kind: CommandKind.ActivateEnergyDump, workerId: w2.id }],
    });
    expect(sim2.state.trails).toHaveLength(1);
    sim2.step({
      tick: 2,
      commands: [{ kind: CommandKind.ActivateEnergyDump, workerId: w2.id }],
    });
    expect(sim2.state.trails).toHaveLength(1); // no second trail

    // Tick out the dump duration. The trail loses its owner reference
    // immediately (worker.activeTrailId reset to 0), then the cooldown
    // counter holds; re-activation rejected during cooldown.
    for (let t = 0; t < 50; t++) {
      sim2.step({ tick: sim2.state.tick, commands: [] });
      if (w2.dumpTicksRemaining === 0 && w2.dumpCooldownTicks > 0) break;
    }
    expect(w2.dumpCooldownTicks).toBeGreaterThan(0);
    sim2.step({
      tick: sim2.state.tick,
      commands: [{ kind: CommandKind.ActivateEnergyDump, workerId: w2.id }],
    });
    expect(sim2.state.trails).toHaveLength(1); // cooldown still active, no third trail
  });

  it('Phase 3.7: dumping worker moves at 2× speed', () => {
    const sim = new Sim(TRAIN_SPEC);
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 5, y: 5 },
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 5, y: 5 },
      ],
    });
    const wDump = sim.state.units[0];
    const wNormal = sim.state.units[1];
    if (wDump.kind !== 'worker' || wNormal.kind !== 'worker') throw new Error('expected workers');
    // Send both to (15, 5) via MoveUnit. The dumping worker should
    // arrive sooner.
    sim.step({
      tick: 1,
      commands: [
        { kind: CommandKind.MoveUnit, unitId: wDump.id, x: 15, y: 5 },
        { kind: CommandKind.MoveUnit, unitId: wNormal.id, x: 15, y: 5 },
        { kind: CommandKind.ActivateEnergyDump, workerId: wDump.id },
      ],
    });
    // Run the dump duration window; compare progress.
    for (let t = 0; t < 40; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(wDump.x).toBeGreaterThan(wNormal.x);
    // Roughly 2× distance covered (allow generous tolerance for tile snap).
    const dumpProgress = wDump.x - 5 * 65536;
    const normalProgress = wNormal.x - 5 * 65536;
    expect(dumpProgress).toBeGreaterThan(normalProgress * 1.5);
  });

  it('Phase 3.7: trail kills enemy unit walking into it; same-faction units survive', () => {
    // Use enemy WORKERS as the sacrificial collision targets — workers
    // don't attack, so combat engagement doesn't entangle the test.
    // Faction-0 worker at (5,5) dumps; an enemy faction-1 worker
    // standing on the same tile dies on the next collision sweep.
    // A second faction-0 worker on the trail proves same-faction
    // immunity.
    const sim = new Sim(TRAIN_SPEC);
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 5, y: 5 },
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 1, x: 5, y: 5 },
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 5, y: 5 },
      ],
    });
    const dumper = sim.state.units[0];
    const enemy = sim.state.units[1];
    const ally = sim.state.units[2];
    if (dumper.kind !== 'worker' || enemy.kind !== 'worker' || ally.kind !== 'worker') {
      throw new Error('expected three workers');
    }
    sim.step({
      tick: 1,
      commands: [{ kind: CommandKind.ActivateEnergyDump, workerId: dumper.id }],
    });
    // After one full step with dump active, segment is laid at (5,5)
    // and the collision sweep kills any non-owner unit overlapping it.
    sim.step({ tick: sim.state.tick, commands: [] });
    expect(enemy.alive).toBe(false);
    expect(ally.alive).toBe(true);
    expect(dumper.alive).toBe(true);
  });

  it('Phase 3.7: trail segments age out; trail dies when empty', () => {
    const sim = new Sim(TRAIN_SPEC);
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 5, y: 5 },
      ],
    });
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    sim.step({
      tick: 1,
      commands: [{ kind: CommandKind.ActivateEnergyDump, workerId: w.id }],
    });
    const trail = sim.state.trails[0];
    expect(trail.alive).toBe(true);
    // Run well past dump duration (40) + segment lifetime (60). After
    // ~40 + 60 ticks the last-laid segment expires and the trail dies.
    for (let t = 0; t < 200; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      if (!trail.alive) break;
    }
    expect(trail.alive).toBe(false);
    expect(trail.segments).toHaveLength(0);
  });

  it('Phase 3.7: ResearchTrailDuration via Spire doubles segment lifetime for the faction', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [],
      initialEnergy: 5000,
      initialFlux: 200,
      initialColor: 1000,
    });
    // Build + finish a Spire.
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'upgrade', x: 4, y: 3 },
      ],
    });
    const s = sim.state.structures[0];
    if (s.kind !== 'upgrade') throw new Error('expected upgrade');
    const buildSteps = s.buildTicksRemaining;
    for (let t = 1; t <= buildSteps + 1; t++) sim.step({ tick: sim.state.tick, commands: [] });

    // Issue trail-duration research.
    sim.step({
      tick: sim.state.tick,
      commands: [
        { kind: CommandKind.ResearchTrailDurationAtStructure, structureId: s.id },
      ],
    });
    expect(s.researchKind).toBe('trailDuration');
    expect(s.researchTicksRemaining).toBeGreaterThan(0);
    const researchSteps = s.researchTicksRemaining;
    for (let i = 0; i < researchSteps; i++) sim.step({ tick: sim.state.tick, commands: [] });
    expect(sim.state.factions[0].trailDurationResearched).toBe(true);
    expect(s.researchKind).toBeNull();

    // Now spawn a worker + dump + measure that the trail outlives
    // the base lifetime.
    sim.step({
      tick: sim.state.tick,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 5, y: 5 },
      ],
    });
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.ActivateEnergyDump, workerId: w.id }],
    });
    const trail = sim.state.trails[0];
    // Run past base lifetime (60 + 40 = 100) but well within doubled
    // lifetime (120 + 40 = 160). Trail should still be alive.
    for (let t = 0; t < 105; t++) sim.step({ tick: sim.state.tick, commands: [] });
    expect(trail.alive).toBe(true);
  });

  it('Phase 3.8: nodes within HQ vision are discovered at match start; nodes outside are not', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [
        { x: 5, y: 5, energy: 100 }, // ~3 tiles from F0 HQ (within 8)
        { x: 15, y: 15, energy: 100 }, // ~3 tiles from F1 HQ (within 8)
        { x: 10, y: 10, energy: 100 }, // ~10 from each HQ (outside both)
      ],
    });
    expect(sim.state.nodes[0].discoveredBy[0]).toBe(true);
    expect(sim.state.nodes[0].discoveredBy[1]).toBe(false);
    expect(sim.state.nodes[1].discoveredBy[0]).toBe(false);
    expect(sim.state.nodes[1].discoveredBy[1]).toBe(true);
    expect(sim.state.nodes[2].discoveredBy[0]).toBe(false);
    expect(sim.state.nodes[2].discoveredBy[1]).toBe(false);
  });

  it('Phase 3.8: walking a worker into vision range discovers a node', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [{ x: 12, y: 12, energy: 100 }], // outside both HQ vision
    });
    expect(sim.state.nodes[0].discoveredBy[0]).toBe(false);
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 8, y: 8 },
      ],
    });
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    // Worker has visionRadius 4. From (8,8) it doesn't yet see (12,12).
    expect(sim.state.nodes[0].discoveredBy[0]).toBe(false);

    // MoveUnit toward the node.
    sim.step({
      tick: 1,
      commands: [{ kind: CommandKind.MoveUnit, unitId: w.id, x: 12, y: 12 }],
    });
    // Worker walks at 0.05/tile/tick. Diagonal Chebyshev step = 0.05
    // on each axis. 4-tile distance → ~80 ticks to close to vision
    // range. Run a generous window.
    let discoveredAtTick = -1;
    for (let t = 0; t < 400; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      if (sim.state.nodes[0].discoveredBy[0]) {
        discoveredAtTick = sim.state.tick;
        break;
      }
    }
    expect(discoveredAtTick).toBeGreaterThan(0);
  });

  it('Phase 3.8: AI auto-assign skips undiscovered nodes', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      // Single faraway node — outside HQ vision for faction 0.
      nodes: [{ x: 15, y: 15, energy: 100 }],
      initialEnergy: 100,
      initialColor: 100,
    });
    expect(sim.state.nodes[0].discoveredBy[0]).toBe(false);
    // Spawn a worker far from the node; tick AI to see if it
    // auto-routes the worker. It should NOT, because the node is
    // undiscovered for faction 0.
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 3, y: 3 },
      ],
    });
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    // Run one AI tick (state.tick === 0 → AI fires). autoAssign
    // shouldn't emit an AssignWorkerToNode command.
    const cmds = autoAssignIdleWorkers(sim.state, 0);
    expect(cmds).toHaveLength(0);
  });

  it('Phase 3.8: AssignWorkerToNode is NOT gated on discovery (sim accepts; only AI / UI filter)', () => {
    // The discovery gate is a presentation + AI concern. The sim itself
    // will accept any AssignWorkerToNode command — a future code path
    // (replay, debug tool, scripted match) can target undiscovered
    // nodes without the sim refusing. Discovery only constrains what
    // the player + AI auto-route can SEE; it doesn't disable the
    // command itself.
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [{ x: 15, y: 15, energy: 100 }], // undiscovered for both factions
    });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 3, y: 3 },
      ],
    });
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    sim.step({
      tick: 1,
      commands: [
        { kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId: sim.state.nodes[0].id },
      ],
    });
    expect(w.targetNodeId).toBe(sim.state.nodes[0].id);
  });

  it('production buildings can be killed; raiders attack them as a fallback before HQ', () => {
    // Set up: faction-0 builds a production building near the contested
    // line; a faction-1 raider spawns next to it via the dev-only
    // SpawnUnit command. The raider should attack the building; once
    // the building dies, the raider falls through to its HQ-march.
    const sim = new Sim({ ...TRAIN_SPEC, initialEnergy: 10000 });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.BuildStructure, faction: 0, structureKind: 'production', x: 10, y: 10 },
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 1, x: 10, y: 10 },
      ],
    });
    const s = asProduction(sim.state.structures[0]);
    const buildSteps = s.buildTicksRemaining;
    // Wait out the build so the raider has a complete target — the
    // structure is alive and combatable from tick 0 either way (alive
    // is the gate, not operational), but starting after build keeps
    // the test scenario unambiguous.
    for (let t = 1; t <= buildSteps; t++) {
      sim.step({ tick: t, commands: [] });
    }
    const startHp = s.hp;
    // Run for a window long enough to kill a 200-HP structure with
    // 15-damage raider attacks on a 15-tick cooldown — ~14 attacks.
    for (let i = 0; i < 300; i++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      if (!s.alive) break;
    }
    expect(s.hp).toBeLessThan(startHp);
    expect(s.alive).toBe(false);
  });
});

describe('Sim — AI', () => {
  it('AI tick is pure: same state + faction → same commands', () => {
    const sim = new Sim(TRAIN_SPEC);
    const a = tickAi(sim.state, 0);
    const b = tickAi(sim.state, 0);
    expect(a).toEqual(b);
  });

  it('AI emits no commands between decision intervals', () => {
    const sim = new Sim(TRAIN_SPEC);
    // Run one tick to bump state.tick from 0 to 1.
    sim.step({ tick: 0, commands: [] });
    expect(sim.state.tick).toBe(1);
    expect(tickAi(sim.state, 0)).toEqual([]);
  });

  it('AI build order — workers → Forge → Spire → defenders → raiders (Phase 3.2)', () => {
    // Phase 3.2 build order: workers (HQ) → Forge → Spire →
    // combat units (defenders + raiders) at the Forge. Research +
    // vanguard appear too with enough Flux throughput, but this test
    // pre-funds Energy only so the build-order shape is observable
    // without needing harvest-time. Tracks all four command kinds the
    // AI can emit in build-order context.
    const sim = new Sim({ ...TRAIN_SPEC, initialEnergy: 10000 });
    const seen: string[] = [];
    for (let t = 0; t < 400; t++) {
      const commands = tickAi(sim.state, 0);
      for (const c of commands) {
        if (c.kind === CommandKind.TrainUnit) seen.push(c.unitKind);
        // Phase 3.10.6: AI now uses BuildStructureByWorker.
        else if (c.kind === CommandKind.BuildStructureByWorker) seen.push(`build:${c.structureKind}`);
        else if (c.kind === CommandKind.TrainAtStructure) seen.push(c.unitKind);
      }
      sim.step({ tick: t, commands });
    }
    expect(seen[0]).toBe('worker');
    const workerEnd = seen.findIndex((k) => k !== 'worker');
    expect(workerEnd).toBeGreaterThanOrEqual(4); // at least WORKER_TARGET workers
    expect(seen[workerEnd]).toBe('build:production'); // Forge before Spire
    const spireIdx = seen.findIndex((k) => k === 'build:upgrade');
    expect(spireIdx).toBeGreaterThan(workerEnd); // Spire after the Forge command
    const defenderStart = seen.findIndex(
      (k, i) => i > spireIdx && k !== 'build:upgrade' && k !== 'build:production',
    );
    expect(seen[defenderStart]).toBe('defender');
    const raiderStart = seen.findIndex((k, i) => i >= defenderStart && k === 'raider');
    expect(raiderStart).toBeGreaterThan(defenderStart);
  });

  it('Phase 3.3: MoveUnit on a worker cancels harvest, walks to the tile, and parks there', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [{ x: 5, y: 5, energy: 100 }],
      initialEnergy: 100,
    });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'worker', faction: 0, x: 5, y: 5 },
      ],
    });
    const w = sim.state.units[0];
    if (w.kind !== 'worker') throw new Error('expected worker');
    const nodeId = sim.state.nodes[0].id;

    // Send to harvest first so we have something to cancel.
    sim.step({
      tick: 1,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId }],
    });
    expect(w.targetNodeId).toBe(nodeId);

    // MoveUnit cancels the harvest target and parks the worker.
    sim.step({
      tick: 2,
      commands: [{ kind: CommandKind.MoveUnit, unitId: w.id, x: 10, y: 10 }],
    });
    expect(w.phase).toBe('idle');
    expect(w.targetNodeId).toBe(0);
    expect(w.moveTarget).not.toBeNull();

    // Run long enough to walk from (5,5) to (10,10) at 0.05/tick.
    // Manhattan distance ~5 tiles, but Chebyshev step → ~100 ticks.
    for (let t = 0; t < 300; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      if (w.x === 10 * 65536 && w.y === 10 * 65536) break;
    }
    expect(w.x).toBe(10 * 65536);
    expect(w.y).toBe(10 * 65536);
    // moveTarget is sticky for workers — they stay parked. autoAssign
    // would re-route them otherwise; the sim's job is to keep them put.
    expect(w.moveTarget).not.toBeNull();
    expect(w.phase).toBe('idle');
  });

  it('Phase 3.3: MoveUnit on a raider overrides the HQ-march and clears on arrival', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [],
      initialEnergy: 100,
    });
    // Spawn a faction-0 raider in the corner. Default behaviour is to
    // march toward enemy HQ (17,17). MoveUnit redirects it to (3,17).
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'raider', faction: 0, x: 3, y: 3 },
      ],
    });
    const r = sim.state.units[0];
    if (r.kind !== 'raider') throw new Error('expected raider');

    sim.step({
      tick: 1,
      commands: [{ kind: CommandKind.MoveUnit, unitId: r.id, x: 3, y: 17 }],
    });
    expect(r.moveTarget).not.toBeNull();
    const startX = r.x;

    // Walk for a window. The override is to (3,17), so x should stay
    // near 3 (not drift toward 17). Once arrived, moveTarget clears
    // and the default march begins again, pulling x toward 17.
    for (let t = 0; t < 400; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      if (r.moveTarget === null) break;
    }
    // moveTarget cleared = arrived.
    expect(r.moveTarget).toBeNull();
    expect(r.y).toBe(17 * 65536);
    // x stayed at the override column the whole way (didn't drift to 17).
    expect(r.x).toBe(startX);

    // Run a few more ticks; the raider resumes default behaviour and
    // starts moving toward HQ (17,17), so x should now begin to climb.
    const xAfterArrival = r.x;
    for (let t = 0; t < 50; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
    }
    expect(r.x).toBeGreaterThan(xAfterArrival);
  });

  it('Phase 3.3: MoveUnit on a defender is a silent no-op (defenders are stationary)', () => {
    const sim = new Sim({
      seed: 1,
      hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 17, y: 17 } },
      nodes: [],
      initialEnergy: 100,
    });
    sim.step({
      tick: 0,
      commands: [
        { kind: CommandKind.SpawnUnit, unitKind: 'defender', faction: 0, x: 5, y: 5 },
      ],
    });
    const d = sim.state.units[0];
    if (d.kind !== 'defender') throw new Error('expected defender');
    sim.step({
      tick: 1,
      commands: [{ kind: CommandKind.MoveUnit, unitId: d.id, x: 10, y: 10 }],
    });
    expect(d.moveTarget).toBeNull(); // sim refused to set the field
    // Ticking forward must not move the defender.
    for (let t = 0; t < 100; t++) sim.step({ tick: sim.state.tick, commands: [] });
    expect(d.x).toBe(5 * 65536);
    expect(d.y).toBe(5 * 65536);
  });

  it('Phase 3.3: MoveUnit on a dead / unknown unit is a silent no-op', () => {
    const sim = new Sim(TRAIN_SPEC);
    // Issue against a never-existed ID. Should not throw, should not
    // mutate anything observable.
    sim.step({
      tick: 0,
      commands: [{ kind: CommandKind.MoveUnit, unitId: 9999, x: 4, y: 4 }],
    });
    expect(sim.state.units.length).toBe(0);
  });

  it('two AI runs of the same match produce identical hash sequences', () => {
    // Mini AI-vs-AI determinism check that doesn't depend on the
    // committed golden fixture (lets us catch AI nondeterminism even
    // before the fixture is regenerated).
    function run(): string[] {
      const sim = new Sim(TRAIN_SPEC);
      const hashes: string[] = [sim.stateHash()];
      for (let t = 0; t < 300; t++) {
        const cmds = [...tickAi(sim.state, 0), ...tickAi(sim.state, 1)];
        sim.step({ tick: t, commands: cmds });
        hashes.push(sim.stateHash());
      }
      return hashes;
    }
    expect(run()).toEqual(run());
  });
});
