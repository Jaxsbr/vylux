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
import { distSq, fromInt, rangeSq, type Fixed } from './fixed';
import { type Faction, type ResourceNode, type SimState } from './types';
import { MAX_TRAIN_QUEUE, RESEARCH_AUTO_RESUME_COST, RESEARCH_SMART_WORKERS_COST, RESEARCH_TRICKLE_COST, STRUCTURE_STATS, canAfford, unitStatsFor } from './units-config';
import { isInChargeMode } from './step';
import { isDepotFootprintBlocked, isFullyExplored, isPodTileBlockedByHq, isPodTileBlockedByNode } from './state';

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

// Phase D.3 — proactive exploration. The stall-based scouting above only fires
// once workers are STARVED (home patch mined out), which means far clusters
// aren't discovered until mid/late game — too late to expand or plant a depot
// on time. So once the AI has at least this many workers (enough to spare one),
// it keeps ONE scout out during buildup even while home nodes remain, so the
// next cluster is discovered BEFORE the home patch runs dry.
const AI_PROACTIVE_SCOUT_MIN_WORKERS = 3;

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

// Phase D.3 — depot planting. The AI plants a depot toward its nearest
// discovered-but-DISTANT cluster to shorten long hauls (the offload point lands
// out by the resources instead of all the way back at the HQ).
const AI_MAX_DEPOT_COUNT = 2;
// Haul-distance threshold: plant a depot only when a discovered live cluster is
// at least this far (Euclidean) from its NEAREST existing offload point — the HQ
// OR an already-built depot. A depot pays off in proportion to haul length, so
// this is the signal: if the cluster is already close to somewhere a worker can
// offload, a depot adds little; once it's far from every offload, plant one. The
// "nearest offload" framing also stops a second depot landing next to the first.
// 10 tiles: maps often seed a cluster 5–6 tiles from the HQ, and a depot there
// lands almost ON the base (it sits ~2–3 tiles off the cluster) — saving only a
// few tiles of travel, which doesn't justify the build. At ~10 tiles the
// round-trip saving is real. Tunable; harder AI tiers can lower it / add
// resource pre-planning.
const AI_DEPOT_HAUL_SQ: Fixed = rangeSq(fromInt(10));
// Candidate 2×2 footprint anchors (min-corner) RELATIVE to the target node's
// tile. Each places the whole footprint clear of the node's Chebyshev-1
// keep-out (all 4 tiles ≥ 2 away). Scanned in order; first buildable wins.
const AI_DEPOT_ANCHOR_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx:  2, dy: -1 }, // right of node
  { dx: -3, dy: -1 }, // left
  { dx: -1, dy:  2 }, // below
  { dx: -1, dy: -3 }, // above
  { dx:  2, dy:  2 }, // diagonals (a touch farther out)
  { dx: -3, dy:  2 },
  { dx:  2, dy: -3 },
  { dx: -3, dy: -3 },
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

  // Builder + in-flight check shared by the depot + pod decisions. Excludes any
  // worker we just sent scouting this frame so a build doesn't yank it off its
  // scout order in the same input frame.
  const builder = pickActionableWorker(state, faction, scout.scoutingIds);
  const buildInFlight = anyPodBuilding(state, faction) || anyDepotBuilding(state, faction);

  // 1) Phase D.3: a forward depot is the AI's TOP build priority — independent
  // of the supply cap — so it lands DURING buildup, when shortening the haul
  // compounds the most, rather than only after the economy is already maxed.
  // When a discovered cluster's haul to its nearest offload point is long enough
  // (pickDepotPlacement returns an anchor), a builder is free, and no build is
  // in flight under the depot ceiling, we either build it now (affordable) or
  // SAVE for it: the depot (60 e) is the priciest single buy, so it perpetually
  // loses the resource race to cheaper workers/pods (40 e) and would never be
  // afforded during buildup. To land it early we pause discretionary spending
  // (worker training + pods) until we can afford it — a short, self-limiting
  // hold (income from existing harvesters keeps flowing via the eco commands
  // already queued above) that ends the instant the depot is placed.
  if (
    builder !== 0
    && !buildInFlight
    && countFriendlyDepots(state, faction) < AI_MAX_DEPOT_COUNT
  ) {
    const anchor = pickDepotPlacement(state, faction);
    if (anchor !== null) {
      if (canAfford(fs, STRUCTURE_STATS.resourceDepot.buildCost)) {
        commands.push({
          kind: CommandKind.BuildStructureByWorker,
          workerId: builder,
          structureKind: 'resourceDepot',
          x: anchor.x,
          y: anchor.y,
        });
        return commands;
      }
      // Wanted but unaffordable → save: skip training + pods this tick so
      // energy/matter accumulate toward the depot instead of being out-spent.
      return commands;
    }
  }

  // 2) Train workers up to the current cap. Phase C.2: queue-aware — the
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

  // 3) At cap — grow the cap by building a work pod. Same gating; tile picked
  // off the deterministic AI_POD_OFFSETS table, clamped to grid bounds (the
  // 64×64 grid is comfortably larger than any offset we use).
  const podStats = STRUCTURE_STATS.workPod;
  const ownedPodCount = countFriendlyPods(state, faction);
  const podInFlight = anyPodBuilding(state, faction);
  if (
    workerCount >= fs.supplyCap
    && !podInFlight
    && !anyDepotBuilding(state, faction)
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
      if (isPodTileBlockedByHq(state, tx, ty)) continue;
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

  // 4) Research. Reached only when training didn't fire this tick (training
  // returns early), so research never competes with worker production — the AI
  // researches with spare economy, exactly as a player does once at cap. The
  // three tracks are independent (different hosts / progress fields) so the AI
  // can have all three in flight at once when it can afford them.
  //
  // Worker-efficiency research (auto-resume + smart-workers) goes FIRST so the
  // AI prioritises keeping its workforce productive — parity with the player,
  // who gets the same two picks. Functionally the AI already micromanages idle
  // workers via autoAssignIdleWorkers, so these don't change its harvesting;
  // they're a deliberate, realistic spend that mirrors the player's tech path.

  // 4a) Auto-resume — hosted at a work pod, uses the single research slot.
  if (
    !fs.autoResumeResearched
    && fs.researchingKind === null
    && canAfford(fs, { energy: RESEARCH_AUTO_RESUME_COST })
  ) {
    const podId = findFriendlyOperationalWorkPod(state, faction);
    if (podId !== 0) {
      commands.push({
        kind: CommandKind.StartResearchAtPod,
        structureId: podId,
        researchKind: 'autoResume',
      });
    }
  }

  // 4b) Smart-workers — hosted at a depot, its own independent track.
  if (
    !fs.smartWorkersResearched
    && fs.smartWorkersResearchTicksRemaining === 0
    && canAfford(fs, RESEARCH_SMART_WORKERS_COST)
  ) {
    const depotId = findFriendlyOperationalDepot(state, faction);
    if (depotId !== 0) {
      commands.push({
        kind: CommandKind.StartResearchAtPod,
        structureId: depotId,
        researchKind: 'smartWorkers',
      });
    }
  }

  // 4c) Phase D.3: passive trickle — hosted at a depot, its own track. Free,
  // recurring economy off a building we already own. One-shot: the gate closes
  // as soon as it starts (ticksRemaining > 0) and stays closed once researched.
  if (
    !fs.trickleResearched
    && fs.trickleResearchTicksRemaining === 0
    && canAfford(fs, RESEARCH_TRICKLE_COST)
  ) {
    const depotId = findFriendlyOperationalDepot(state, faction);
    if (depotId !== 0) {
      commands.push({
        kind: CommandKind.StartResearchAtPod,
        structureId: depotId,
        researchKind: 'resourceTrickle',
      });
    }
  }

  return commands;
}

// Lowest-id friendly OPERATIONAL depot (0 = none). Used by the AI's trickle +
// smart-workers research decisions to pick a host building.
function findFriendlyOperationalDepot(state: SimState, faction: Faction): number {
  let best = 0;
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'resourceDepot') continue;
    if (s.buildTicksRemaining > 0) continue;
    if (best === 0 || s.id < best) best = s.id;
  }
  return best;
}

// Lowest-id friendly OPERATIONAL work pod (0 = none). Host for the AI's
// auto-resume research decision (mirrors findFriendlyOperationalDepot).
function findFriendlyOperationalWorkPod(state: SimState, faction: Faction): number {
  let best = 0;
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'workPod') continue;
    if (s.buildTicksRemaining > 0) continue;
    if (best === 0 || s.id < best) best = s.id;
  }
  return best;
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

  // Stall-based: when workers are genuinely starved (home depleted), scale the
  // scout count with how many are stalled.
  if (candidates.length > 0) {
    const desired = Math.min(AI_MAX_SCOUTS, Math.max(1, Math.ceil(candidates.length / 2)));
    const toSend = Math.max(0, desired - activeScouts);
    for (let k = 0; k < toSend && k < candidates.length; k++) {
      commands.push({ kind: CommandKind.ScoutWorker, workerId: candidates[k] });
      scoutingIds.add(candidates[k]);
    }
  }

  // Phase D.3 proactive exploration: even when nobody is stalled, keep ONE scout
  // out during buildup so far clusters are discovered EARLY — the prerequisite
  // for expanding + planting a depot on time. Only while the AI still wants
  // depots (under the ceiling) and has workers to spare; pulls a single
  // (lowest-id actionable) worker. Skipped if a scout is already out, here or
  // from a prior frame. The pulled worker may be mid-harvest — acceptable: one
  // explorer out of a growing workforce is a small, deliberate economy cost.
  if (
    activeScouts === 0
    && scoutingIds.size === 0
    && countFriendlyDepots(state, faction) < AI_MAX_DEPOT_COUNT
    && countOwnedWorkers(state, faction) >= AI_PROACTIVE_SCOUT_MIN_WORKERS
  ) {
    for (let i = 0; i < state.units.length; i++) {
      const u = state.units[i];
      if (!u.alive || u.faction !== faction || u.kind !== 'worker') continue;
      if (exclude !== undefined && exclude.has(u.id)) continue;
      if (isInChargeMode(u) || u.charge < 1) continue;
      if (u.phase === 'scouting') continue;
      commands.push({ kind: CommandKind.ScoutWorker, workerId: u.id });
      scoutingIds.add(u.id);
      break;
    }
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

// Phase D.3 depot bookkeeping — count of friendly depots (any build state) and
// whether one is mid-construction. Mirrors the pod helpers.
function countFriendlyDepots(state: SimState, faction: Faction): number {
  let n = 0;
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'resourceDepot') continue;
    n += 1;
  }
  return n;
}

function anyDepotBuilding(state: SimState, faction: Faction): boolean {
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'resourceDepot') continue;
    if (s.buildTicksRemaining > 0) return true;
  }
  return false;
}

// Squared distance from (x, y) to the nearest friendly depot (any build state),
// or null if the faction owns none. Used to avoid planting two depots that
// would serve the same cluster.
function nearestDepotDistSq(state: SimState, faction: Faction, x: Fixed, y: Fixed): Fixed | null {
  let best: Fixed | null = null;
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'resourceDepot') continue;
    const d = distSq(x, y, s.x, s.y);
    if (best === null || d < best) best = d;
  }
  return best;
}

// Phase D.3: choose where to plant a forward depot. Finds the NEAREST discovered
// live cluster whose haul to its nearest existing offload point (HQ or an
// existing depot) exceeds AI_DEPOT_HAUL_SQ — i.e. a cluster currently suffering
// a long haul — then scans candidate 2×2 footprint anchors around it for the
// first buildable one. Returns the min-corner tile, or null if no cluster needs
// a depot / no clear footprint. Deterministic: nodes scanned in array order,
// nearest-to-HQ with lowest-id tiebreak (so the AI expands outward gradually);
// anchors scanned in fixed table order.
function pickDepotPlacement(state: SimState, faction: Faction): { x: number; y: number } | null {
  const fs = state.factions[faction];
  let bestNode: ResourceNode | null = null;
  let bestD: Fixed = 0;
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (!n.alive) continue;
    if (n.remaining <= 0) continue;
    if (!n.discoveredBy[faction]) continue;
    const dHq = distSq(n.x, n.y, fs.hqX, fs.hqY);
    const dDepot = nearestDepotDistSq(state, faction, n.x, n.y);
    // Distance to the nearest place this cluster could already offload at.
    const offloadDistSq = dDepot === null ? dHq : (dDepot < dHq ? dDepot : dHq);
    if (offloadDistSq < AI_DEPOT_HAUL_SQ) continue; // already close to an offload
    if (bestNode === null || dHq < bestD || (dHq === bestD && n.id < bestNode.id)) {
      bestNode = n;
      bestD = dHq;
    }
  }
  if (bestNode === null) return null;
  const nx = toInt(bestNode.x);
  const ny = toInt(bestNode.y);
  for (let i = 0; i < AI_DEPOT_ANCHOR_OFFSETS.length; i++) {
    const ax = nx + AI_DEPOT_ANCHOR_OFFSETS[i].dx;
    const ay = ny + AI_DEPOT_ANCHOR_OFFSETS[i].dy;
    // isDepotFootprintBlocked also rejects out-of-bounds footprints.
    if (!isDepotFootprintBlocked(state, ax, ay)) return { x: ax, y: ay };
  }
  return null;
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
