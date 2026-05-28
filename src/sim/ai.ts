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
import { MAX_TRAIN_QUEUE, STRUCTURE_STATS, canAfford, unitStatsFor } from './units-config';
import { isInChargeMode } from './step';
import { isFullyExplored, isPodTileBlockedByNode } from './state';

export const AI_TICK_INTERVAL = 10;

// Cap on AI-built pods. HQ provides 5; max pods → 5 × 5 = 25 extra,
// so total worker cap caps out at ~30. More than enough for a single
// AI to hit while we're still scoping Phase C.
const AI_MAX_POD_COUNT = 5;

// Phase C.6.10 — scouting tuning.
// A worker idle (with no discovered live node to harvest) this many ticks is
// "stalled" and eligible to be dispatched as a scout. Comfortably above
// AI_TICK_INTERVAL so a worker about to be auto-assigned on the next AI tick
// isn't sent off prematurely — only a genuinely starved worker crosses it.
const AI_IDLE_SCOUT_TICKS = 40;
// Hard ceiling on simultaneous scouts per faction. The AI scales scouts with
// how many workers are stalled (the discovery-speed vs. harvester-count
// tradeoff), but never sends the whole army exploring — enough stay home to
// harvest whatever the scouts uncover.
const AI_MAX_SCOUTS = 3;

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

  // Phase D.1: keep ONE worker steadily on matter so the dual-cost pod build
  // (40 E + 30 M) never starves. Runs FIRST and claims its worker via an
  // exclusion set so autoAssign + scouting don't fight over it the same frame.
  // The kind-agnostic autoAssign would otherwise re-point a freshly-assigned
  // matter worker at the nearest (possibly energy) node.
  const matter = ensureMatterHarvester(state, faction);
  const commands: Command[] = matter.commands.slice();
  for (const c of autoAssignIdleWorkers(state, faction, matter.assignedIds)) commands.push(c);
  // Phase C.6.10: send stalled workers scouting so the AI discovers fresh
  // nodes instead of stalling once its home patch depletes. autoAssign above
  // already routes any worker that HAS a discovered live node; dispatchScouts
  // only takes the genuinely starved ones (idle past the threshold with no
  // node to harvest), so the two never command the same worker in one frame.
  const scout = dispatchScouts(state, faction, matter.assignedIds);
  for (let i = 0; i < scout.commands.length; i++) commands.push(scout.commands[i]);
  const fs = state.factions[faction];
  const workerCount = countOwnedWorkers(state, faction);
  const workerCost = unitStatsFor(fs.factionId, 'worker').trainCost;

  // 1) Train workers up to the current cap. Phase C.2: queue-aware — the
  // sim reserves supply for already-queued units, so the AI counts the
  // queue too (otherwise it would spam TrainUnit commands the sim
  // silently rejects, and over-commit once they all pop).
  const queued = fs.trainQueue.length;
  if (
    fs.supplyUsed + queued < fs.supplyCap
    && queued < MAX_TRAIN_QUEUE
    && canAfford(fs, workerCost)
  ) {
    commands.push({ kind: CommandKind.TrainUnit, faction, unitKind: 'worker' });
    return commands;
  }

  // 2) At cap — try to grow the cap by building a work pod.
  // Conditions: workforce filling the cap, no pending build already
  // in-flight, can afford the pod, an actionable worker is available,
  // and we haven't hit the AI's pod ceiling. Tile picked off the
  // deterministic AI_POD_OFFSETS table indexed by current pod count;
  // clamped to grid bounds (the 64×64 grid is comfortably larger than
  // any offset we use).
  const podStats = STRUCTURE_STATS.workPod;
  const ownedPodCount = countFriendlyPods(state, faction);
  const podInFlight = anyPodBuilding(state, faction);
  // Exclude any worker we just sent scouting this frame, so a pod build
  // doesn't yank it back off its scout order in the same input frame.
  const builder = pickActionableWorker(state, faction, scout.scoutingIds);
  if (
    workerCount >= fs.supplyCap
    && !podInFlight
    && ownedPodCount < AI_MAX_POD_COUNT
    && canAfford(fs, podStats.buildCost)
    && builder !== 0
  ) {
    // Pick the first deterministic offset whose tile is buildable — clear of
    // energy nodes (C.6.6 keep-out, else the sim rejects the build) and not
    // already taken by a friendly pod. Scanning (rather than indexing straight
    // by pod count) keeps the AI from spinning forever on an offset that
    // happens to sit next to a node. While no pod has died it picks the same
    // tiles in the same order as the old index-by-count (pods occupy 0..n-1).
    // Limitations deferred to C.6.7 (AI-behaviour overhaul): if ALL offsets are
    // node-blocked the AI builds no pod (rare on the random map; C.6.7 adds
    // cluster-aware placement), and once pod death exists (Phase D) the scan
    // refills the lowest free offset rather than tracking by count.
    for (let i = 0; i < AI_POD_OFFSETS.length; i++) {
      const offset = AI_POD_OFFSETS[i];
      const tx = clampTile(toInt(fs.hqX) + offset.dx, state.gridSize);
      const ty = clampTile(toInt(fs.hqY) + offset.dy, state.gridSize);
      if (isPodTileBlockedByNode(state, tx, ty)) continue;
      if (friendlyPodOnTile(state, faction, tx, ty)) continue;
      commands.push({
        kind: CommandKind.BuildStructureByWorker,
        workerId: builder,
        structureKind: 'workPod',
        x: tx,
        y: ty,
      });
      break;
    }
  }

  return commands;
}

// Is a friendly work pod already sitting on tile (tileX, tileY)? Used so the
// AI's offset scan doesn't re-pick a tile it already built on.
function friendlyPodOnTile(state: SimState, faction: Faction, tileX: number, tileY: number): boolean {
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'workPod') continue;
    if (toInt(s.x) === tileX && toInt(s.y) === tileY) return true;
  }
  return false;
}

// Phase D.1: ensure exactly ONE worker is steadily harvesting matter, so the
// AI can afford the dual-cost pod (40 E + 30 M). Pods cost matter now, but the
// AI's nearest-node harvesting is kind-agnostic and its guaranteed near-HQ
// node is energy — so without this it might never collect matter and never
// raise its supply cap.
//
// Policy ("one steady harvester"): if a worker is already committed to matter
// (assigned to a matter node, or carrying matter home), do nothing — it stays
// the harvester. Otherwise claim the idle, actionable worker nearest the
// nearest discovered matter node and assign it. The returned id is excluded
// from autoAssign + scouting this frame so nothing re-commands it. Returns no
// command (and an empty set) when no matter is discovered yet, or no worker is
// free — the AI simply builds pods later once matter is found.
//
// Deterministic: nodes/workers scanned in array order, nearest with lowest-id
// tiebreak. No RNG.
function ensureMatterHarvester(
  state: SimState,
  faction: Faction,
): { commands: Command[]; assignedIds: Set<number> } {
  const assignedIds = new Set<number>();

  // Already have a worker on matter? Assigned-to-a-matter-node covers
  // moving/harvesting/returning (targetNodeId persists across the cycle);
  // carrying matter is the belt-and-braces case.
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive || u.faction !== faction || u.kind !== 'worker') continue;
    if (u.carriedKind === 'matter' && u.carrying > 0) return { commands: [], assignedIds };
    if (u.targetNodeId !== 0) {
      const tn = findNodeById(state, u.targetNodeId);
      if (tn !== null && tn.kind === 'matter') return { commands: [], assignedIds };
    }
  }

  // No matter discovered yet → nothing to do (build pods later).
  const node = nearestLiveNode(state, faction, state.factions[faction].hqX, state.factions[faction].hqY, 'matter');
  if (node === null) return { commands: [], assignedIds };

  // Claim the idle, actionable worker nearest that matter node (same gates as
  // autoAssign), lowest-id tiebreak.
  let bestId = 0;
  let bestD: Fixed = 0;
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive || u.faction !== faction || u.kind !== 'worker') continue;
    if (u.phase !== 'idle') continue;
    if (u.targetNodeId !== 0) continue;
    if (u.moveTarget !== null) continue;
    if (isInChargeMode(u)) continue;
    if (u.charge <= 0) continue;
    const d = distSq(u.x, u.y, node.x, node.y);
    if (bestId === 0 || d < bestD) {
      bestId = u.id;
      bestD = d;
    }
  }
  if (bestId === 0) return { commands: [], assignedIds };
  assignedIds.add(bestId);
  return {
    commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: bestId, nodeId: node.id }],
    assignedIds,
  };
}

// Point every idle worker (phase==='idle' with no node target and no
// active manual move-park) at the nearest live energy node. Skips
// workers in charge mode — the sim is autonomously walking them to a
// charge spot, and a re-assign from the AI would just bounce off the
// applyCommand charge gate.
export function autoAssignIdleWorkers(
  state: SimState,
  faction: Faction,
  exclude?: ReadonlySet<number>,
): Command[] {
  const out: Command[] = [];
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive) continue;
    if (u.faction !== faction) continue;
    if (u.kind !== 'worker') continue;
    if (exclude !== undefined && exclude.has(u.id)) continue;
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

// Phase C.6.10: decide which (if any) stalled workers to send scouting this
// AI tick. A worker qualifies when it is idle, has been stalled past the
// threshold, can act (charge + not charging), AND has NO discovered live node
// to harvest — that last test is the key one: it means autoAssignIdleWorkers
// produced nothing for this worker, so scouting it can't collide with a
// harvest order in the same frame, and it scopes scouting to the genuine
// "home patch exhausted, nothing left to do" stall.
//
// The COUNT is the discovery-speed vs. harvester-count tradeoff the AI gets to
// make: it scales scouts with how many workers are stalled (≈ half of them),
// capped at AI_MAX_SCOUTS and net of any already out scouting — so a deeply
// stalled AI explores faster, but always keeps workers home to harvest what
// the scouts reveal. Returns the commands plus the set of dispatched ids (so
// the pod-builder pick can avoid double-commanding a fresh scout).
//
// Deterministic: candidates are gathered in units-array order (ascending id,
// since the array never reorders) and taken lowest-id first; the count is
// integer arithmetic on counts. No RNG.
function dispatchScouts(
  state: SimState,
  faction: Faction,
  exclude?: ReadonlySet<number>,
): { commands: Command[]; scoutingIds: Set<number> } {
  const commands: Command[] = [];
  const scoutingIds = new Set<number>();
  // Nothing to scout once the faction's map is fully revealed.
  if (isFullyExplored(state, faction)) return { commands, scoutingIds };

  let activeScouts = 0;
  const candidates: number[] = [];
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive) continue;
    if (u.faction !== faction) continue;
    if (u.kind !== 'worker') continue;
    // Don't scout a worker the matter-harvester pass just claimed this frame.
    if (exclude !== undefined && exclude.has(u.id)) continue;
    if (u.phase === 'scouting') { activeScouts += 1; continue; }
    if (u.phase !== 'idle') continue;
    if (u.moveTarget !== null) continue;
    if (isInChargeMode(u)) continue;
    if (u.charge < 1) continue;
    if (u.idleTicks < AI_IDLE_SCOUT_TICKS) continue;
    // Has a node to harvest → autoAssign owns this worker; don't scout it.
    if (nearestLiveNode(state, faction, u.x, u.y) !== null) continue;
    candidates.push(u.id);
  }
  if (candidates.length === 0) return { commands, scoutingIds };

  const desired = Math.min(AI_MAX_SCOUTS, Math.max(1, Math.ceil(candidates.length / 2)));
  const toSend = Math.max(0, desired - activeScouts);
  for (let k = 0; k < toSend && k < candidates.length; k++) {
    commands.push({ kind: CommandKind.ScoutWorker, workerId: candidates[k] });
    scoutingIds.add(candidates[k]);
  }
  return { commands, scoutingIds };
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
function pickActionableWorker(
  state: SimState,
  faction: Faction,
  exclude?: ReadonlySet<number>,
): number {
  let best = 0;
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive) continue;
    if (u.faction !== faction) continue;
    if (u.kind !== 'worker') continue;
    if (isInChargeMode(u)) continue;
    if (u.charge < 1) continue;
    // Don't pull a worker already out scouting (prior tick) back into a pod
    // build — let it finish exploring. (`exclude` covers scouts dispatched
    // THIS frame, which are still phase 'idle' until the command applies.)
    if (u.phase === 'scouting') continue;
    if (exclude !== undefined && exclude.has(u.id)) continue;
    if (best === 0 || u.id < best) best = u.id;
  }
  return best;
}

// Lowest-ID tiebreaker on equal distance — same convention as the rest
// of the sim. Skips undiscovered nodes so the AI doesn't auto-route to
// nodes its faction hasn't scouted yet.
// Node lookup by id. Nodes never reorder (tombstones keep array order), so a
// scan is stable + deterministic. Returns null if absent or dead.
function findNodeById(state: SimState, id: number): ResourceNode | null {
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (n.id === id) return n.alive ? n : null;
  }
  return null;
}

function nearestLiveNode(
  state: SimState,
  faction: Faction,
  x: Fixed,
  y: Fixed,
  kind?: ResourceNode['kind'],
): ResourceNode | null {
  let best: ResourceNode | null = null;
  let bestD: Fixed = 0;
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (!n.alive) continue;
    if (n.remaining <= 0) continue;
    if (!n.discoveredBy[faction]) continue;
    if (kind !== undefined && n.kind !== kind) continue;
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

function clampTile(t: number, gridSize: number): number {
  // Sim doesn't validate tile bounds; clamp here so an out-of-grid placement
  // doesn't strand a worker. Bound is derived from the match's gridSize (now a
  // configurable spec field — was hard-coded 63 assuming a 64² grid, which
  // stranded the AI's builder on any non-64 grid).
  return Math.max(0, Math.min(gridSize - 1, t));
}
