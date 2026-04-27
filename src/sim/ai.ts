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
import { distSq, toFloat, type Fixed } from './fixed';
import {
  findFirstOperationalProduction,
  findFirstOperationalUpgrade,
  findFirstUpgradeAnyState,
} from './state';
import { FACTION_COLOR, type Faction, type ProductionBuilding, type ResourceNode, type SimState } from './types';
import {
  STRUCTURE_STATS,
  TIER2_COLOR_COST,
  TIER2_FLUX_COST,
  UNIT_STATS,
} from './units-config';
import type { SupplyStructure } from './types';

export const AI_TICK_INTERVAL = 10;

const WORKER_TARGET = 4;
const DEFENDER_TARGET = 2;

export function tickAi(state: SimState, faction: Faction): Command[] {
  // Decision cadence — only act every AI_TICK_INTERVAL ticks.
  if (state.tick % AI_TICK_INTERVAL !== 0) return [];

  const commands: Command[] = autoAssignIdleWorkers(state, faction);
  const counts = countOwnedUnits(state, faction);
  const fs = state.factions[faction];

  // Phase 3.2 + 3.5: research tier 2 at a faction-owned upgrade
  // structure (Spire) as soon as it's available + affordable. Now
  // also gated on colour cost (3.5).
  if (!fs.tier2Researched && fs.flux >= TIER2_FLUX_COST && fs.color >= TIER2_COLOR_COST) {
    const idleSpire = findFirstOperationalUpgrade(state, faction);
    if (idleSpire !== null) {
      commands.push({
        kind: CommandKind.ResearchTier2AtStructure,
        structureId: idleSpire.id,
      });
    }
  }

  // Phase 3.1: route one worker to the nearest Flux node while the
  // faction is pre-research. autoAssignIdleWorkers above is kind-
  // agnostic and naturally favours the closer Energy nodes; without
  // this bias Flux never accumulates. The reassignment is idempotent
  // — the same worker (lowest-ID candidate not already on Flux) gets
  // pointed at the Flux node every AI tick. Comes AFTER autoAssign so
  // it overrides any energy-node assignment for that one worker.
  if (!fs.tier2Researched) {
    const fluxNode = nearestLiveNodeOfKind(state, faction, fs.hqX, fs.hqY, 'flux');
    if (fluxNode !== null) {
      for (let i = 0; i < state.units.length; i++) {
        const u = state.units[i];
        if (!u.alive || u.faction !== faction || u.kind !== 'worker') continue;
        // Only retarget workers that aren't already harvesting / returning.
        if (u.phase === 'harvesting' || u.phase === 'returning') continue;
        if (u.targetNodeId === fluxNode.id) break; // already on Flux
        commands.push({
          kind: CommandKind.AssignWorkerToNode,
          workerId: u.id,
          nodeId: fluxNode.id,
        });
        break;
      }
    }
  }

  // Phase 3.5: same single-worker-bias for own-colour nodes when the
  // pool is below a soft target. Generalises 3.1's flux bias — without
  // this the AI would let its colour pool drain and lock its own
  // production despite there being colour nodes on the map. Threshold
  // sized so the bias kicks in when the AI can no longer afford a
  // burst of training (~2 raiders + a Forge).
  const ownColor = FACTION_COLOR[faction];
  const COLOR_BIAS_THRESHOLD = 50 << 16; // 50 in Fixed Q16.16
  if (fs.color < COLOR_BIAS_THRESHOLD) {
    const colorNode = nearestLiveNodeOfKindWithReserve(state, faction, fs.hqX, fs.hqY, ownColor);
    if (colorNode !== null) {
      for (let i = 0; i < state.units.length; i++) {
        const u = state.units[i];
        if (!u.alive || u.faction !== faction || u.kind !== 'worker') continue;
        if (u.phase === 'harvesting' || u.phase === 'returning') continue;
        if (u.targetNodeId === colorNode.id) break; // already on it
        commands.push({
          kind: CommandKind.AssignWorkerToNode,
          workerId: u.id,
          nodeId: colorNode.id,
        });
        break;
      }
    }
  }

  // Phase 3.2 build order:
  //   - workers up to WORKER_TARGET (HQ)
  //   - one Forge (production building) for tier-1 combat
  //   - one Spire (upgrade structure) once we can afford it
  //   - tier-2 research (handled above) once Spire is operational + Flux ready
  //   - defenders up to DEFENDER_TARGET (Forge)
  //   - vanguards (post-research) preferred over raiders
  //
  // Single-of-each-structure in 3.2; multiple Forges + branching tech
  // are later sub-phase concerns. The AI commits to deterministic
  // offsets from its HQ for both buildings.

  if (
    counts.workers < WORKER_TARGET &&
    fs.energy >= UNIT_STATS.worker.trainCost &&
    fs.color >= UNIT_STATS.worker.trainColorCost &&
    fs.supplyUsed + UNIT_STATS.worker.supplyCost <= fs.supplyCap
  ) {
    commands.push({ kind: CommandKind.TrainUnit, faction, unitKind: 'worker' });
    return commands;
  }

  const ownForge = findFirstOperationalProductionAnyState(state, faction);
  if (ownForge === null) {
    if (
      fs.energy >= STRUCTURE_STATS.production.buildCost &&
      fs.color >= STRUCTURE_STATS.production.buildColorCost
    ) {
      const tile = forgeTileFor(state, faction);
      commands.push({
        kind: CommandKind.BuildStructure,
        faction,
        structureKind: 'production',
        x: tile.x,
        y: tile.y,
      });
    }
    return commands;
  }

  // Phase 3.2: build a Spire once we have a Forge. The Spire is cheaper
  // than a Forge (100 vs 150 energy) but commits the build window the
  // opponent can punish — the early-tech-vs-early-aggression decision
  // PRD §6.4 commits to. Phase 3.5: colour gate added.
  if (
    !fs.tier2Researched &&
    findFirstUpgradeAnyState(state, faction) === null &&
    fs.energy >= STRUCTURE_STATS.upgrade.buildCost &&
    fs.color >= STRUCTURE_STATS.upgrade.buildColorCost
  ) {
    const tile = spireTileFor(state, faction);
    commands.push({
      kind: CommandKind.BuildStructure,
      faction,
      structureKind: 'upgrade',
      x: tile.x,
      y: tile.y,
    });
    return commands;
  }

  // Phase 3.6: Pylon trigger. When supplyUsed is within 2 of the cap
  // and resources permit, build a Pylon — only if there isn't one
  // already in progress (otherwise the AI would queue a new Pylon
  // every tick of the current build window, burning energy).
  if (
    fs.supplyUsed >= fs.supplyCap - 2 &&
    fs.energy >= STRUCTURE_STATS.supply.buildCost &&
    fs.color >= STRUCTURE_STATS.supply.buildColorCost &&
    !hasPylonInProgress(state, faction)
  ) {
    const tile = pylonTileFor(state, faction);
    commands.push({
      kind: CommandKind.BuildStructure,
      faction,
      structureKind: 'supply',
      x: tile.x,
      y: tile.y,
    });
    return commands;
  }

  if (ownForge.buildTicksRemaining > 0 || ownForge.trainingKind !== null) {
    // Forge is busy (still building or already mid-train). Skip combat
    // training this tick — single-slot model means we can't queue
    // ahead of the current job.
    return commands;
  }

  const operationalForge = findFirstOperationalProduction(state, faction);
  if (operationalForge === null) return commands;

  const trainKind = pickCombatTrainTarget(counts, fs);
  if (trainKind !== null) {
    commands.push({
      kind: CommandKind.TrainAtStructure,
      structureId: operationalForge.id,
      unitKind: trainKind,
    });
  }

  return commands;
}

// Returns the faction's first owned production building regardless of
// build state, including ones still under construction. Used by the AI
// to avoid queuing a second Forge while the first is still being built.
function findFirstOperationalProductionAnyState(state: SimState, faction: Faction): ProductionBuilding | null {
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'production') continue;
    return s;
  }
  return null;
}

// Forge placement: a deterministic tile offset from the HQ. Faction 0
// places to the south-east of its HQ, faction 1 to the north-west of
// its HQ — same logical "in front of base, between HQ and the contested
// middle." Pure function of HQ coordinates, no RNG.
function forgeTileFor(state: SimState, faction: Faction): { x: number; y: number } {
  const fs = state.factions[faction];
  const hqX = Math.round(toFloat(fs.hqX));
  const hqY = Math.round(toFloat(fs.hqY));
  const dx = faction === 0 ? 2 : -2;
  const dy = faction === 0 ? 2 : -2;
  return { x: hqX + dx, y: hqY + dy };
}

// Phase 3.2 Spire placement: alongside the Forge, one tile further out
// on the perpendicular axis. Same deterministic-offset shape; same
// rule that 3.5 will replace once map data is real.
function spireTileFor(state: SimState, faction: Faction): { x: number; y: number } {
  const fs = state.factions[faction];
  const hqX = Math.round(toFloat(fs.hqX));
  const hqY = Math.round(toFloat(fs.hqY));
  // Faction 0: 1 tile east of HQ, same Y. Faction 1: 1 tile west.
  // Different axis from Forge so the two structures don't overlap.
  const dx = faction === 0 ? 1 : -1;
  const dy = 0;
  return { x: hqX + dx, y: hqY + dy };
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
    // Phase 3.3: a worker with a manual move-target is "parked here on
    // purpose" — auto-assign would erase the player's order on the next
    // tick. Skip them; they stay parked until the player issues another
    // command (assign-to-node or another move).
    if (u.moveTarget !== null) continue;
    const nearest = nearestHarvestableNode(state, faction, u.x, u.y);
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

// Combat-only picker — used after the worker target is met and a Forge
// is operational. Phase 3.2 prefers vanguards once tier-2 is researched
// and the faction can afford one (Energy + Flux); otherwise falls back
// to the Phase 3.0 defender → raider order.
function pickCombatTrainTarget(
  counts: UnitCounts,
  fs: {
    energy: Fixed;
    flux: Fixed;
    color: Fixed;
    tier2Researched: boolean;
    supplyCap: number;
    supplyUsed: number;
  },
): 'defender' | 'raider' | 'vanguard' | null {
  // Phase 3.5/3.6: skip a kind unless every cost dimension (energy,
  // flux, colour, supply) can be covered. Without this the AI emits
  // doomed TrainAtStructure commands each tick that the sim silently
  // rejects, cluttering the input log + replay. Doomed commands are
  // also wasteful in lockstep — every command is a network message.
  const supplyAvail = fs.supplyCap - fs.supplyUsed;
  if (
    fs.tier2Researched &&
    fs.energy >= UNIT_STATS.vanguard.trainCost &&
    fs.flux >= UNIT_STATS.vanguard.trainFluxCost &&
    fs.color >= UNIT_STATS.vanguard.trainColorCost &&
    supplyAvail >= UNIT_STATS.vanguard.supplyCost
  ) {
    return 'vanguard';
  }
  if (
    counts.defenders < DEFENDER_TARGET &&
    fs.energy >= UNIT_STATS.defender.trainCost &&
    fs.color >= UNIT_STATS.defender.trainColorCost &&
    supplyAvail >= UNIT_STATS.defender.supplyCost
  ) {
    return 'defender';
  }
  if (
    fs.energy >= UNIT_STATS.raider.trainCost &&
    fs.color >= UNIT_STATS.raider.trainColorCost &&
    supplyAvail >= UNIT_STATS.raider.supplyCost
  ) {
    return 'raider';
  }
  return null;
}

// Phase 3.6: detect an alive Pylon mid-build for the given faction —
// used by the Pylon trigger to avoid queuing a second Pylon every tick
// of the current build window.
function hasPylonInProgress(state: SimState, faction: Faction): boolean {
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'supply') continue;
    const pylon = s as SupplyStructure;
    if (pylon.buildTicksRemaining > 0) return true;
  }
  return false;
}

// Phase 3.6: Pylon placement — deterministic offset from HQ, on a
// different axis from the Forge + Spire so all three structures don't
// overlap. Faction 0 places north of HQ; faction 1 south. Same shape
// as forgeTileFor / spireTileFor.
function pylonTileFor(state: SimState, faction: Faction): { x: number; y: number } {
  const fs = state.factions[faction];
  const hqX = Math.round(toFloat(fs.hqX));
  const hqY = Math.round(toFloat(fs.hqY));
  const dx = 0;
  const dy = faction === 0 ? -2 : 2;
  return { x: hqX + dx, y: hqY + dy };
}

// Phase 3.5+3.8: colour-aware + discovery-aware nearest-node selector.
// Skips:
//   - dead nodes (energy/flux that have been depleted)
//   - undiscovered nodes (3.8: AI can only auto-route to nodes its own
//     faction has scouted; same constraint as the player, who can only
//     click on discovered nodes)
//   - opposite-colour nodes (the worker can't legally harvest them)
//   - depleted colour nodes (remaining <= 0; harvest would just bounce
//     the worker back to idle; let them try a different node next tick)
// Tiebreaker: lowest entity ID, same as every other targeting helper
// in the sim.
function nearestHarvestableNode(
  state: SimState,
  faction: Faction,
  fromX: Fixed,
  fromY: Fixed,
): number | null {
  const ownColor = FACTION_COLOR[faction];
  let bestId: number | null = null;
  let bestDistSq: Fixed = 0;
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (!n.alive) continue;
    if (!n.discoveredBy[faction]) continue;
    if (n.remaining <= 0) continue;
    if ((n.kind === 'blue' || n.kind === 'red') && n.kind !== ownColor) continue;
    const d = distSq(fromX, fromY, n.x, n.y);
    if (bestId === null || d < bestDistSq || (d === bestDistSq && n.id < bestId)) {
      bestId = n.id;
      bestDistSq = d;
    }
  }
  return bestId;
}

// Phase 3.1: kind-filtered variant of nearestLiveNode. Used by the AI
// to route workers to a Flux node specifically, regardless of whether
// closer Energy nodes exist. Tiebreaker: lowest-ID, same as the kind-
// agnostic version.
function nearestLiveNodeOfKind(
  state: SimState,
  faction: Faction,
  fromX: Fixed,
  fromY: Fixed,
  kind: 'energy' | 'flux',
): { id: number } | null {
  let best: { id: number } | null = null;
  let bestDistSq: Fixed = 0;
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (!n.alive || n.kind !== kind) continue;
    // Phase 3.8: only consider nodes the faction has discovered.
    if (!n.discoveredBy[faction]) continue;
    const d = distSq(fromX, fromY, n.x, n.y);
    if (best === null || d < bestDistSq || (d === bestDistSq && n.id < best.id)) {
      best = { id: n.id };
      bestDistSq = d;
    }
  }
  return best;
}

// Phase 3.5: colour-node variant — skips depleted nodes (remaining<=0)
// because colour nodes don't die at empty (regen brings them back),
// but routing a worker to an exhausted node wastes a harvest cycle.
// Phase 3.8 adds the discovery filter — same shape as everywhere else.
function nearestLiveNodeOfKindWithReserve(
  state: SimState,
  faction: Faction,
  fromX: Fixed,
  fromY: Fixed,
  kind: 'blue' | 'red',
): ResourceNode | null {
  let best: ResourceNode | null = null;
  let bestDistSq: Fixed = 0;
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (!n.alive || n.kind !== kind) continue;
    if (!n.discoveredBy[faction]) continue;
    if (n.remaining <= 0) continue;
    const d = distSq(fromX, fromY, n.x, n.y);
    if (best === null || d < bestDistSq || (d === bestDistSq && n.id < best.id)) {
      best = n;
      bestDistSq = d;
    }
  }
  return best;
}
