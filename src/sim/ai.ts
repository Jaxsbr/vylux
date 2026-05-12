// Scripted AI for the Phase C.1 surface.
//
// Design contract:
// - Pure function: same (state, faction) → same commands, every time.
// - No RNG access. Tiebreakers are deterministic (lowest entity ID, etc.).
// - Reads sim state, writes nothing. The runner submits the returned
//   commands as part of the input frame, where they're indistinguishable
//   from human commands.
//
// Phase C.1 scope: the AI keeps an economy running and actively grows
// its worker force. Training workers up to the faction's supply cap;
// pointing idle workers at the nearest live energy node; building work
// pods when at cap so the cap raises. Workers in charge mode are
// skipped — the sim handles recharge autonomously. The AI does not
// research yet (the auto-resume research is a player-facing decision
// for now; it can be added to the AI loop later).

import { CommandKind, type Command } from './commands';
import { distSq, fromInt, type Fixed } from './fixed';
import { type Faction, type ResourceNode, type SimState } from './types';
import { STRUCTURE_STATS, UNIT_STATS } from './units-config';
import { isInChargeMode } from './step';

export const AI_TICK_INTERVAL = 10;

// Cap on AI-built pods. HQ provides 5; max pods → 5 × 5 = 25 extra,
// so total worker cap caps out at ~30. More than enough for a single
// AI to hit while we're still scoping Phase C.
const AI_MAX_POD_COUNT = 5;

// Deterministic offsets from the AI's HQ for placed pods. Indexed by
// the current count of friendly pods (alive, any build state). Chosen
// to spread pods around the home patch without overlapping the worker
// spawn perimeter. Tiles are integers — the sim accepts them as
// fromInt() coords at apply time.
const AI_POD_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx:  5, dy:  0 },
  { dx:  0, dy:  5 },
  { dx: -5, dy:  0 },
  { dx:  0, dy: -5 },
  { dx:  5, dy:  5 },
];

export function tickAi(state: SimState, faction: Faction): Command[] {
  if (state.tick % AI_TICK_INTERVAL !== 0) return [];

  const commands: Command[] = autoAssignIdleWorkers(state, faction);
  const fs = state.factions[faction];
  const workerCount = countOwnedWorkers(state, faction);
  const workerCost = UNIT_STATS.worker.trainCost;

  // 1) Train workers up to the current cap.
  if (
    workerCount < fs.supplyCap
    && fs.supplyUsed < fs.supplyCap
    && fs.energy >= workerCost
  ) {
    commands.push({ kind: CommandKind.TrainUnit, faction, unitKind: 'worker' });
    return commands;
  }

  // 2) At cap — try to grow the cap by building a work pod.
  // Conditions: workforce filling the cap, no pending build already
  // in-flight, can afford the pod, an actionable worker is available,
  // and we haven't hit the AI's pod ceiling. Tile picked off the
  // deterministic AI_POD_OFFSETS table indexed by current pod count;
  // clamped to grid bounds (the SPEC's 32x32 grid is comfortably
  // larger than any offset we use).
  const podStats = STRUCTURE_STATS.workPod;
  const ownedPodCount = countFriendlyPods(state, faction);
  const podInFlight = anyPodBuilding(state, faction);
  const builder = pickActionableWorker(state, faction);
  if (
    workerCount >= fs.supplyCap
    && !podInFlight
    && ownedPodCount < AI_MAX_POD_COUNT
    && fs.energy >= podStats.buildCost
    && builder !== 0
  ) {
    const offset = AI_POD_OFFSETS[ownedPodCount % AI_POD_OFFSETS.length];
    const tx = clampTile(toInt(fs.hqX) + offset.dx);
    const ty = clampTile(toInt(fs.hqY) + offset.dy);
    commands.push({
      kind: CommandKind.BuildStructureByWorker,
      workerId: builder,
      structureKind: 'workPod',
      x: tx,
      y: ty,
    });
  }

  return commands;
}

// Point every idle worker (phase==='idle' with no node target and no
// active manual move-park) at the nearest live energy node. Skips
// workers in charge mode — the sim is autonomously walking them to a
// charge spot, and a re-assign from the AI would just bounce off the
// applyCommand charge gate.
export function autoAssignIdleWorkers(state: SimState, faction: Faction): Command[] {
  const out: Command[] = [];
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive) continue;
    if (u.faction !== faction) continue;
    if (u.kind !== 'worker') continue;
    if (u.phase !== 'idle') continue;
    if (u.targetNodeId !== 0) continue;
    if (u.moveTarget !== null) continue;
    if (isInChargeMode(u)) continue;
    if (u.charge <= 0) continue;
    const node = nearestLiveNode(state, faction, u.x, u.y);
    if (node === null) continue;
    out.push({ kind: CommandKind.AssignWorkerToNode, workerId: u.id, nodeId: node.id });
  }
  return out;
}

function countOwnedWorkers(state: SimState, faction: Faction): number {
  let n = 0;
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive) continue;
    if (u.faction !== faction) continue;
    if (u.kind !== 'worker') continue;
    n += 1;
  }
  return n;
}

function countFriendlyPods(state: SimState, faction: Faction): number {
  let n = 0;
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'workPod') continue;
    n += 1;
  }
  return n;
}

function anyPodBuilding(state: SimState, faction: Faction): boolean {
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'workPod') continue;
    if (s.buildTicksRemaining > 0) return true;
  }
  return false;
}

// Lowest-ID actionable worker for the AI — alive, owned, in `idle` or
// a harvest phase, not in charge mode, with charge to pay for a task.
// 0 = no candidate. Returning a friendly worker that's currently
// harvesting is fine: the BuildStructureByWorker command supersedes
// the harvest at apply-time.
function pickActionableWorker(state: SimState, faction: Faction): number {
  let best = 0;
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive) continue;
    if (u.faction !== faction) continue;
    if (u.kind !== 'worker') continue;
    if (isInChargeMode(u)) continue;
    if (u.charge < 1) continue;
    if (best === 0 || u.id < best) best = u.id;
  }
  return best;
}

// Lowest-ID tiebreaker on equal distance — same convention as the rest
// of the sim. Skips undiscovered nodes so the AI doesn't auto-route to
// nodes its faction hasn't scouted yet.
function nearestLiveNode(state: SimState, faction: Faction, x: Fixed, y: Fixed): ResourceNode | null {
  let best: ResourceNode | null = null;
  let bestD: Fixed = 0;
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (!n.alive) continue;
    if (n.remaining <= 0) continue;
    if (!n.discoveredBy[faction]) continue;
    const d = distSq(x, y, n.x, n.y);
    if (best === null || d < bestD || (d === bestD && n.id < best.id)) {
      best = n;
      bestD = d;
    }
  }
  return best;
}

// HQ coords are stored as Q16.16 Fixed. The AI needs raw tile ints to
// build the placement command. fromInt(toInt(x)) round-trips for any
// integer-aligned Fixed (which HQ coords are by construction).
function toInt(f: Fixed): number {
  return Math.round(f / fromInt(1));
}

function clampTile(t: number): number {
  // Sim doesn't validate tile bounds; clamp here so an out-of-grid
  // placement doesn't strand a worker. 32×32 grid → valid range [0, 31].
  return Math.max(0, Math.min(31, t));
}
