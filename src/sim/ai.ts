// Scripted AI for Phase 1.1.
//
// Design contract:
// - Pure function: same (state, faction, tick) → same commands, every time.
// - No RNG access. Tiebreakers are deterministic (lowest entity ID, etc.).
// - Reads sim state, writes nothing. The runner submits the returned
//   commands as part of the input frame, where they're indistinguishable
//   from human commands. Replays capture and reproduce them exactly.
//
// Decision cadence: once every AI_TICK_INTERVAL ticks (rather than every
// tick) so the build order doesn't churn. 10 ticks at 20 Hz = 0.5s, fine
// granularity for a build-order AI.
//
// Build order shape:
//   - Always train workers up to a target count.
//   - Once the worker target is met, train a small defender garrison.
//   - After defenders, churn raiders forever — each new raider auto-marches
//     toward the enemy HQ.
//
// Worker assignment: any idle worker (phase=='idle' with no target) is
// pointed at the nearest live energy node, lowest-ID tiebreaker.
//
// All thresholds are constants here for now. Phase 3 likely exposes them
// as a difficulty-tier config.

import { CommandKind, type Command } from './commands';
import { distSq, type Fixed } from './fixed';
import type { Faction, SimState, Unit } from './types';
import { UNIT_STATS } from './units-config';

export const AI_TICK_INTERVAL = 10;

const WORKER_TARGET = 4;
const DEFENDER_TARGET = 2;

export function tickAi(state: SimState, faction: Faction): Command[] {
  // Decision cadence — only act every AI_TICK_INTERVAL ticks.
  if (state.tick % AI_TICK_INTERVAL !== 0) return [];

  const commands: Command[] = autoAssignIdleWorkers(state, faction);
  const counts = countOwnedUnits(state, faction);

  // Build order — train one unit per AI tick (avoids draining the entire
  // energy bank in a single decision). Workers → defenders → raiders.
  const fs = state.factions[faction];
  const trainCommand = pickTrainTarget(counts, fs.energy);
  if (trainCommand !== null) {
    commands.push({
      kind: CommandKind.TrainUnit,
      faction,
      unitKind: trainCommand,
    });
  }

  return commands;
}

// Player-controlled factions get the same idle-worker convenience the
// AI does. Phase 3 may revisit if "select worker → click node" becomes
// part of the design; for Phase 1 mouse-only play it would be busywork.
export function autoAssignIdleWorkers(state: SimState, faction: Faction): Command[] {
  const commands: Command[] = [];
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive || u.faction !== faction || u.kind !== 'worker') continue;
    if (u.phase !== 'idle' || u.targetNodeId !== 0) continue;
    const nearest = nearestLiveNode(state, u.x, u.y);
    if (nearest !== null) {
      commands.push({
        kind: CommandKind.AssignWorkerToNode,
        workerId: u.id,
        nodeId: nearest,
      });
    }
  }
  return commands;
}

interface UnitCounts {
  workers: number;
  defenders: number;
  raiders: number;
}

function countOwnedUnits(state: SimState, faction: Faction): UnitCounts {
  let workers = 0;
  let defenders = 0;
  let raiders = 0;
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive || u.faction !== faction) continue;
    switch (u.kind) {
      case 'worker': workers++; break;
      case 'defender': defenders++; break;
      case 'raider': raiders++; break;
    }
  }
  return { workers, defenders, raiders };
}

function pickTrainTarget(counts: UnitCounts, energy: Fixed): Unit['kind'] | null {
  if (counts.workers < WORKER_TARGET && energy >= UNIT_STATS.worker.trainCost) {
    return 'worker';
  }
  if (counts.defenders < DEFENDER_TARGET && energy >= UNIT_STATS.defender.trainCost) {
    return 'defender';
  }
  if (energy >= UNIT_STATS.raider.trainCost) {
    return 'raider';
  }
  return null;
}

function nearestLiveNode(state: SimState, fromX: Fixed, fromY: Fixed): number | null {
  let bestId: number | null = null;
  let bestDistSq: Fixed = 0;
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (!n.alive) continue;
    const d = distSq(fromX, fromY, n.x, n.y);
    if (bestId === null || d < bestDistSq || (d === bestDistSq && n.id < bestId)) {
      bestId = n.id;
      bestDistSq = d;
    }
  }
  return bestId;
}
