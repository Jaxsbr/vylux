// One tick of the simulation. Pure-by-convention — given the same state
// and same inputs, mutates state to the same result every time.
//
// Step ordering (load-bearing for determinism):
//   1. Apply all input commands in given order (deterministic dispatch).
//   2. Advance units in array-index order.
//   3. Advance structures in array-index order (build-phase tick is on
//      the worker side — see advanceWorker 'building'; structure pass
//      just handles tombstoning if hp hits 0 in a future combat pass).
//   4. Recompute supply caps from current operational-pod counts +
//      alive-worker counts.
//   5. Discovery sweep — mark nodes inside friendly vision.
//   6. Exploration sweep — mark the per-faction explored TILE set inside
//      friendly vision (Phase C.6.7; the fog the AI scouts against).
//   7. Win-condition check (HQ destruction); preserves a winner already
//      set by an in-frame Resign command.
//   8. Bump tick counter, mirror RNG state.
//
// Mutation is in-place. The renderer never sees mid-step state because
// the renderer pulls from sim only between ticks.
//
// Phase C.1 (2026-05-12): workers carry per-unit charge. Each task
// drains 1 at task-start. Movement is free while charge > 0; a worker
// at charge === 0 enters charge mode (walkingToCharge → charging) and
// refuses all player commands until full recharge. The charge spot is
// the physically NEAREST of (a) any friendly operational work pod or
// (b) the friendly HQ — a worker no longer treks across the map to a
// distant pod when its own HQ is right next door. The HQ recharges at
// 50% the pod rate, so a pod still wins on ties / equal distance.

import { Rng } from './rng';
import { CommandKind, type Command, type InputFrame } from './commands';
import {
  findNearestFriendlyOperationalDepot,
  findNearestFriendlyOperationalWorkPod,
  findNode,
  findStructure,
  findUnit,
  isDepotFootprintBlocked,
  isPodTileBlockedByHq,
  isPodTileBlockedByNode,
  markExploredCircle,
  spawnStructure,
  spawnUnit,
} from './state';
import {
  type Faction,
  type FactionState,
  type ResourceKind,
  type SimState,
  type Structure,
  type Unit,
  type Worker,
} from './types';
import { abs, add, distSq, FIXED_ONE, fromFloat, fromInt, rangeSq, sub, type Fixed } from './fixed';
import { decideScoreWinner } from './score';
import { findPath, tileAxis, tileCenter, packTile, NO_EXEMPT, type PathBlocker } from './pathfind';
import {
  CHARGE_TICKS_PER_UNIT_HQ,
  CHARGE_TICKS_PER_UNIT_POD,
  CHARGE_COST_PER_TASK,
  DEPOT_BUILD_REACH_SQ,
  DEPOT_DEPOSIT_REACH_SQ,
  DEPOT_TRICKLE_AMOUNT,
  DEPOT_TRICKLE_INTERVAL_TICKS,
  HQ_CHARGE_SLOT_COUNT,
  HQ_CHARGE_SLOT_OFFSETS,
  HQ_SUPPLY_CAP_INITIAL,
  HQ_VISION_RADIUS,
  MAX_TRAIN_QUEUE,
  POD_CHARGE_SLOT_COUNT,
  POD_CHARGE_SLOT_OFFSETS,
  RESEARCH_AUTO_RESUME_COST,
  RESEARCH_AUTO_RESUME_TICKS,
  RESEARCH_TRICKLE_COST,
  RESEARCH_TRICKLE_TICKS,
  STRUCTURE_STATS,
  UNIT_STATS,
  WORK_POD_BUILD_REACH_SQ,
  WORK_POD_CAP_BONUS,
  canAfford,
  spendCost,
  factionConfigFor,
  unitStatsFor,
} from './units-config';

// Worker-loop tuning. Per-kind stats live in units-config.ts; these are
// loop-shape constants that don't fit there.
export const WORKER_REACH_SQ: Fixed = rangeSq(fromFloat(0.06));
export const HARVEST_TICKS = 20; // 1 second at 20 Hz — shared baseline; per-faction overrides via factionConfigFor
export const HARVEST_AMOUNT: Fixed = fromInt(5);
export const WORKER_CAPACITY: Fixed = fromInt(5);

// HQ-perimeter spawn offsets for newly-trained workers.
export const HQ_PERIMETER_OFFSETS: ReadonlyArray<{ dx: number; dy: number }> = [
  { dx:  2, dy:  0 },
  { dx:  0, dy:  2 },
  { dx: -2, dy:  0 },
  { dx:  0, dy: -2 },
  { dx:  2, dy:  2 },
  { dx: -2, dy:  2 },
  { dx: -2, dy: -2 },
  { dx:  2, dy: -2 },
];

// Harvest slot allocation. Six hex-arranged points at radius ~0.55 around
// a resource node. Workers assigned to a node pick the lowest-index unused
// slot at AssignWorkerToNode time.
const HARVEST_SLOT_R: Fixed = fromFloat(0.55);
const HARVEST_SLOT_R_HALF: Fixed = fromFloat(0.275);
const HARVEST_SLOT_R_SQRT3_2: Fixed = fromFloat(0.476); // 0.55 * sqrt(3)/2
export const HARVEST_SLOT_COUNT = 6;
export const HARVEST_SLOT_OFFSETS: ReadonlyArray<{ dx: Fixed; dy: Fixed }> = [
  { dx:  HARVEST_SLOT_R,        dy:  0 },
  { dx:  HARVEST_SLOT_R_HALF,   dy:  HARVEST_SLOT_R_SQRT3_2 },
  { dx: -HARVEST_SLOT_R_HALF,   dy:  HARVEST_SLOT_R_SQRT3_2 },
  { dx: -HARVEST_SLOT_R,        dy:  0 },
  { dx: -HARVEST_SLOT_R_HALF,   dy: -HARVEST_SLOT_R_SQRT3_2 },
  { dx:  HARVEST_SLOT_R_HALF,   dy: -HARVEST_SLOT_R_SQRT3_2 },
];

// Formation offsets for multi-unit MoveUnit.
const FORMATION_R: Fixed = fromFloat(0.7);
const FORMATION_R_HALF: Fixed = fromFloat(0.35);
const FORMATION_R_SQRT3_2: Fixed = fromFloat(0.606); // 0.7 * sqrt(3)/2
export const FORMATION_SLOT_COUNT = 7;
export const FORMATION_OFFSETS: ReadonlyArray<{ dx: Fixed; dy: Fixed }> = [
  { dx:  0,                  dy:  0 },
  { dx:  FORMATION_R,        dy:  0 },
  { dx:  FORMATION_R_HALF,   dy:  FORMATION_R_SQRT3_2 },
  { dx: -FORMATION_R_HALF,   dy:  FORMATION_R_SQRT3_2 },
  { dx: -FORMATION_R,        dy:  0 },
  { dx: -FORMATION_R_HALF,   dy: -FORMATION_R_SQRT3_2 },
  { dx:  FORMATION_R_HALF,   dy: -FORMATION_R_SQRT3_2 },
];

// Workers stop at the HQ perimeter to deposit (don't walk into the HQ
// silhouette). 2.0² gives an arrival ring just outside the HQ visual.
export const HQ_DEPOSIT_REACH_SQ: Fixed = rangeSq(fromFloat(2.0));

// Widened harvest-arrival radius. WORKER_REACH_SQ (0.06²) is the snap-to
// "I'm exactly here" check; HARVEST_AT_NODE_REACH_SQ (0.55²) is the
// "close-enough-to-start-harvesting" gate so workers cluster naturally
// around a node instead of fighting for its exact centre.
export const HARVEST_AT_NODE_REACH_SQ: Fixed = rangeSq(fromFloat(0.55));

// Phase C.1: a worker in `walkingToCharge` or `charging` is in CHARGE
// MODE — exported so the renderer + input layers can gate visuals + cues
// off the same predicate.
export function isInChargeMode(w: Worker): boolean {
  return w.phase === 'walkingToCharge' || w.phase === 'charging';
}

// Phase C.1 (revised): charge-spot picking. Pick the physically NEAREST
// charge spot — the closest friendly operational work pod OR the friendly
// HQ, whichever the worker is actually nearer to. The old rule always
// preferred any pod regardless of distance, which sent a worker across the
// map to a far pod while its own HQ sat one tile away. The HQ wins only
// when strictly closer; ties go to the pod (it recharges twice as fast).
// The chosen spot's structure id is recorded on `chargeTargetStructureId`
// (0 = HQ since HQs aren't entities in the structures array; the
// faction-on-worker disambiguates which HQ).
function pickChargeTarget(state: SimState, w: Worker): { x: Fixed; y: Fixed; structureId: number } {
  const fs = state.factions[w.faction];
  const pod = findNearestFriendlyOperationalWorkPod(state, w.faction, w.x, w.y);
  if (pod === null) {
    return { x: fs.hqX, y: fs.hqY, structureId: 0 };
  }
  const podDistSq = distSq(w.x, w.y, pod.x, pod.y);
  const hqDistSq = distSq(w.x, w.y, fs.hqX, fs.hqY);
  if (hqDistSq < podDistSq) {
    return { x: fs.hqX, y: fs.hqY, structureId: 0 };
  }
  return { x: pod.x, y: pod.y, structureId: pod.id };
}

// Phase D.1/D.3: credit a deposited resource to the matching faction pool AND
// its cumulative *Harvested twin (the match-score spine — total resources
// collected, energy + matter). The spendable pool drops on spend; the
// harvested totals never decrement. This is the SINGLE place deposits are
// credited — shared by the HQ arrival, the depot arrival, and the depot
// passive trickle — so the pool and the score spine can never drift apart.
function creditDeposit(fs: FactionState, kind: ResourceKind, amount: Fixed): void {
  if (kind === 'matter') {
    fs.matter = add(fs.matter, amount);
    fs.matterHarvested = add(fs.matterHarvested, amount);
  } else {
    fs.energy = add(fs.energy, amount);
    fs.energyHarvested = add(fs.energyHarvested, amount);
  }
}

// Phase D.3 (the long-haul stall fix): pick where a returning worker offloads
// — the nearest of {friendly HQ, friendly operational depots}. Mirrors
// pickChargeTarget exactly: HQ wins only when STRICTLY closer; a depot wins
// ties. (Deposit is instant either way, so the tie-break is cosmetic — matching
// pickChargeTarget keeps the two structurally identical.) structureId 0 = HQ.
function pickDepositTarget(state: SimState, w: Worker): { x: Fixed; y: Fixed; structureId: number } {
  const fs = state.factions[w.faction];
  const depot = findNearestFriendlyOperationalDepot(state, w.faction, w.x, w.y);
  if (depot === null) {
    return { x: fs.hqX, y: fs.hqY, structureId: 0 };
  }
  const depotDistSq = distSq(w.x, w.y, depot.x, depot.y);
  const hqDistSq = distSq(w.x, w.y, fs.hqX, fs.hqY);
  if (hqDistSq < depotDistSq) {
    return { x: fs.hqX, y: fs.hqY, structureId: 0 };
  }
  return { x: depot.x, y: depot.y, structureId: depot.id };
}

// Phase D.3: transition a worker into the `returning` phase, locking in its
// offload target NOW (not re-evaluated per tick) so it doesn't oscillate
// mid-haul if a depot finishes construction along the way. Called wherever the
// worker starts carrying home.
function enterReturning(state: SimState, w: Worker): void {
  w.depositTargetStructureId = pickDepositTarget(state, w).structureId;
  w.phase = 'returning';
}

// Phase D.3: resolve a returning worker's current offload point + arrival reach.
// Honours the locked depot target; if that depot has died / been demoted
// before arrival, re-pick (so the worker never walks to a corpse) and fall
// back to the HQ when nothing else qualifies.
function resolveDeposit(state: SimState, w: Worker): { x: Fixed; y: Fixed; reachSq: Fixed } {
  const fs = state.factions[w.faction];
  if (w.depositTargetStructureId !== 0) {
    const d = findStructure(state, w.depositTargetStructureId);
    if (d !== null && d.alive && d.kind === 'resourceDepot' && d.buildTicksRemaining === 0) {
      return { x: d.x, y: d.y, reachSq: DEPOT_DEPOSIT_REACH_SQ };
    }
    // Locked depot gone — re-pick the nearest valid target from here.
    const repick = pickDepositTarget(state, w);
    w.depositTargetStructureId = repick.structureId;
    if (repick.structureId !== 0) {
      return { x: repick.x, y: repick.y, reachSq: DEPOT_DEPOSIT_REACH_SQ };
    }
  }
  return { x: fs.hqX, y: fs.hqY, reachSq: HQ_DEPOSIT_REACH_SQ };
}

// Phase C.1: pick the lowest-index unused charge slot at the chosen
// spot. Spot is keyed by (faction, chargeTargetStructureId) — pod ids
// are globally unique; HQ uses structureId = 0 with the worker's
// faction as disambiguator. Excludes the worker itself so a re-pick
// (e.g. after the target pod completes mid-walk) doesn't see the
// worker's own old slot as taken.
function pickChargeSlot(
  state: SimState,
  faction: 0 | 1,
  spotStructureId: number,
  selfId: number,
): number {
  const count = spotStructureId === 0 ? HQ_CHARGE_SLOT_COUNT : POD_CHARGE_SLOT_COUNT;
  const used: boolean[] = new Array(count).fill(false);
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive || u.kind !== 'worker') continue;
    if (u.id === selfId) continue;
    if (u.faction !== faction) continue;
    if (!isInChargeMode(u)) continue;
    if (u.chargeTargetStructureId !== spotStructureId) continue;
    const s = u.chargeSlot;
    if (s >= 0 && s < count) used[s] = true;
  }
  for (let s = 0; s < count; s++) {
    if (!used[s]) return s;
  }
  // Overflow — more workers than slots. Stack on slot 0; the only
  // cost is visual overlap, which is the original symptom we're
  // mitigating, not a hard requirement.
  return 0;
}

// Translate a worker's charge-mode target into its slot position. Picks
// the offset table off the spot kind (pod vs HQ). Slot index wraps
// modulo the table length for safety (shouldn't happen given pickChargeSlot
// bounds, but defensive against future expansions).
function chargeSlotPosition(
  spotX: Fixed,
  spotY: Fixed,
  spotStructureId: number,
  slot: number,
): { x: Fixed; y: Fixed } {
  const table = spotStructureId === 0 ? HQ_CHARGE_SLOT_OFFSETS : POD_CHARGE_SLOT_OFFSETS;
  const offset = table[slot % table.length];
  return { x: add(spotX, offset.dx), y: add(spotY, offset.dy) };
}

// Phase C.1: end-of-task / charge-check entry point. Called whenever a
// worker finishes its current task (deposit, build complete) or has its
// task dropped (assign rejected, structure depleted). If charge has
// dropped to 0, the worker enters `walkingToCharge`; otherwise it
// reverts to idle (or whatever the caller already set).
function maybeEnterChargeMode(state: SimState, w: Worker): void {
  if (w.charge > 0) return;
  if (isInChargeMode(w)) return;
  // Phase C.1 auto-resume: if this worker was harvesting (or had a
  // current harvest target), remember the node so post-charge logic
  // can resume the task automatically (gated on the faction's
  // autoResumeResearched flag). Any other transition path (build,
  // explicit MoveUnit) already cleared previousNodeId.
  if (w.targetNodeId !== 0) {
    w.previousNodeId = w.targetNodeId;
  }
  const target = pickChargeTarget(state, w);
  w.chargeTargetStructureId = target.structureId;
  w.chargeTicksAccrued = 0;
  // Phase C.1 slot allocation: pick a hex / octagonal slot around the
  // spot so multiple charging workers don't stack on one point.
  w.chargeSlot = pickChargeSlot(state, w.faction, target.structureId, w.id);
  // Drop any other task state so the worker doesn't try to resume mid
  // charge-cycle. moveTarget is intentionally cleared too — a 0-charge
  // worker can't accept player moves either.
  w.moveTarget = null;
  w.targetNodeId = 0;
  w.targetNodeSlot = 0;
  w.harvestTicksRemaining = 0;
  w.carrying = 0;
  w.carriedKind = 'energy';
  w.targetStructureId = 0;
  // Phase D.3: drop any locked offload target — charge mode aborts the haul.
  w.depositTargetStructureId = 0;
  // If the worker is already standing at its slot, skip the walk
  // phase. Reach is against the slot point (WORKER_REACH_SQ) — workers
  // who happen to spawn at their slot don't need a no-op walk frame.
  const slotPos = chargeSlotPosition(target.x, target.y, target.structureId, w.chargeSlot);
  w.phase = distSq(w.x, w.y, slotPos.x, slotPos.y) <= WORKER_REACH_SQ
    ? 'charging'
    : 'walkingToCharge';
  if (w.phase === 'charging') {
    // Snap to slot for a bit-stable resting position.
    w.x = slotPos.x;
    w.y = slotPos.y;
  }
}

// Phase C.1 auto-resume: called when a worker finishes charging. If the
// faction has the auto-resume research AND the worker remembers a
// previous harvest node AND that node is still alive AND the worker
// has the charge to pay for a new harvest cycle, kick the cycle off.
// Otherwise the worker drops to idle and clears its previousNodeId.
function maybeAutoResumeAfterCharge(state: SimState, w: Worker): void {
  const fs = state.factions[w.faction];
  if (!fs.autoResumeResearched) {
    w.previousNodeId = 0;
    return;
  }
  if (w.previousNodeId === 0) return;
  const node = findNode(state, w.previousNodeId);
  if (node === null) {
    w.previousNodeId = 0;
    return;
  }
  if (w.charge < CHARGE_COST_PER_TASK) return;
  // Resume — same shape as applyCommand AssignWorkerToNode, minus the
  // command path. We're spending a fresh charge to start the cycle.
  w.charge -= CHARGE_COST_PER_TASK;
  w.targetNodeSlot = pickHarvestSlot(state, node.id, w.id);
  w.targetNodeId = node.id;
  w.phase = 'movingToNode';
  w.moveTarget = null;
}

export function applyCommand(state: SimState, cmd: Command): void {
  switch (cmd.kind) {
    case CommandKind.Noop:
      return;
    case CommandKind.AssignWorkerToNode: {
      const u = findUnit(state, cmd.workerId);
      if (!u || u.kind !== 'worker') return;
      const n = findNode(state, cmd.nodeId);
      if (!n) return;
      // Phase C.1: charge gate. A worker in charge mode (or at 0 charge)
      // silently rejects new task assignments. The renderer surfaces a
      // floating "needs charge" lightning cue when this filter trips.
      if (isInChargeMode(u)) return;
      if (u.charge < CHARGE_COST_PER_TASK) return;
      // Phase C.1: drain at TASK START. One harvest cycle = 1 energy.
      // The deduction lands now (not at deposit) so an aborted cycle
      // costs the player the same as a completed one.
      u.charge -= CHARGE_COST_PER_TASK;
      // Pick a harvest slot before binding the worker to the node —
      // counted across all currently-assigned workers, so a multi-worker
      // fan-out (player click on node with 3 workers selected → 3
      // sequential AssignWorkerToNode commands in one frame) gets slots
      // 0, 1, 2 picked in order.
      u.targetNodeSlot = pickHarvestSlot(state, n.id, u.id);
      u.targetNodeId = n.id;
      // Phase D.3: a worker re-assigned while already carrying heads home
      // first — lock its offload target now (enterReturning); otherwise it
      // walks to the node to harvest.
      if (u.carrying > 0) {
        enterReturning(state, u);
      } else {
        u.phase = 'movingToNode';
      }
      // Any node-assign command supersedes a manual park.
      u.moveTarget = null;
      // Dropping any pending build assignment if there was one (would
      // already have refunded the energy charge at start).
      u.targetStructureId = 0;
      // The player issued an explicit harvest — that's the new "previous
      // task" for auto-resume purposes (replacing any older one).
      u.previousNodeId = n.id;
      // Phase C.6.6: drop the cached A* route — the destination changed, and
      // navigate() keys its cache on the destination TILE alone, so a retarget
      // that happens to round to the same tile (or with a different exempt
      // blocker) would otherwise reuse a stale/drained path.
      u.path.length = 0;
      u.pathGoalTile = -1;
      return;
    }
    case CommandKind.TrainUnit: {
      // Phase C.2: training is queued + timed, not instant. The command
      // pays energy + reserves supply at enqueue; advanceProduction ticks
      // the head down and spawns it on completion.
      const fs = state.factions[cmd.faction];
      const stats = unitStatsFor(fs.factionId, cmd.unitKind);
      if (!canAfford(fs, stats.trainCost)) return;
      // Reserve supply: live workers (supplyUsed, recomputed end-of-step
      // so stable here) PLUS already-queued units must stay under the cap.
      // Silent reject when the cap is full or the queue is full.
      if (fs.supplyUsed + fs.trainQueue.length >= fs.supplyCap) return;
      if (fs.trainQueue.length >= MAX_TRAIN_QUEUE) return;
      spendCost(fs, stats.trainCost);
      // Resolve the spawn tile NOW (concrete Fixed coords) so the queue
      // item is fully hashable and the perimeter rotation advances
      // deterministically at enqueue. Explicit tile = click-to-place;
      // otherwise the HQ-perimeter round-robin.
      let spawnX: Fixed;
      let spawnY: Fixed;
      if (cmd.x !== undefined && cmd.y !== undefined) {
        spawnX = fromInt(cmd.x);
        spawnY = fromInt(cmd.y);
      } else {
        const offset = HQ_PERIMETER_OFFSETS[fs.nextSpawnRotation % HQ_PERIMETER_OFFSETS.length];
        fs.nextSpawnRotation = (fs.nextSpawnRotation + 1) | 0;
        spawnX = add(fs.hqX, fromInt(offset.dx));
        spawnY = add(fs.hqY, fromInt(offset.dy));
      }
      fs.trainQueue.push({ kind: cmd.unitKind, x: spawnX, y: spawnY });
      // If this is the only item, it's the head — start its timer.
      if (fs.trainQueue.length === 1) {
        fs.trainTicksRemaining = stats.trainTicks;
      }
      return;
    }
    case CommandKind.MoveUnit: {
      const u = findUnit(state, cmd.unitId);
      if (!u) return;
      // Phase C.1: a worker at 0 charge (or in charge mode) refuses
      // move orders too. Per the answer to open Q3 — moves are free
      // while energy exists, but a depleted worker is fully locked
      // until recharge.
      if (u.kind === 'worker' && (isInChargeMode(u) || u.charge < CHARGE_COST_PER_TASK)) return;
      const tx = fromInt(cmd.x);
      const ty = fromInt(cmd.y);
      // Formation retention — see FORMATION_OFFSETS comment.
      const slot = pickFormationSlot(state, tx, ty, u.id);
      const offset = FORMATION_OFFSETS[slot];
      u.moveTarget = { x: add(tx, offset.dx), y: add(ty, offset.dy) };
      if (u.kind === 'worker') {
        u.phase = 'idle';
        u.targetNodeId = 0;
        u.targetNodeSlot = 0;
        u.harvestTicksRemaining = 0;
        u.targetStructureId = 0;
        // Phase C.6.6: invalidate the cached A* route on retarget (see the
        // AssignWorkerToNode note — navigate caches on destination tile only).
        u.path.length = 0;
        u.pathGoalTile = -1;
        // Explicit move overrides any auto-resume memory — the player
        // is reposting this worker, don't second-guess them later.
        u.previousNodeId = 0;
      }
      return;
    }
    case CommandKind.BuildStructureByWorker: {
      // Phase C.1: worker-driven structure construction. The named
      // worker walks to the placement tile and ticks down the new
      // structure's buildTicksRemaining while on site.
      const w = findUnit(state, cmd.workerId);
      if (w === null || !w.alive || w.kind !== 'worker') return;
      if (isInChargeMode(w)) return;
      if (w.charge < CHARGE_COST_PER_TASK) return;
      // Phase C.6.6: keep work pods out of a node's immediate ring so the
      // node's harvest-slot approach stays clear (the worker's blind final
      // hop to a slot would otherwise clip a pod glued to the node). Phase D.3:
      // the depot obeys the same keep-out rules across its whole 2×2 footprint.
      if (
        cmd.structureKind === 'workPod' &&
        (isPodTileBlockedByNode(state, cmd.x, cmd.y) || isPodTileBlockedByHq(state, cmd.x, cmd.y))
      ) {
        return;
      }
      if (cmd.structureKind === 'resourceDepot' && isDepotFootprintBlocked(state, cmd.x, cmd.y)) {
        return;
      }
      const fs = state.factions[w.faction];
      const stats = STRUCTURE_STATS[cmd.structureKind];
      if (!canAfford(fs, stats.buildCost)) return;
      // Pay the resource cost (energy + matter for a pod) + the worker's
      // charge atomically — all fail together, or all apply together.
      spendCost(fs, stats.buildCost);
      w.charge -= CHARGE_COST_PER_TASK;
      const newStructure = spawnStructure(
        state,
        cmd.structureKind,
        w.faction,
        fromInt(cmd.x),
        fromInt(cmd.y),
      );
      // Drop any in-progress harvest / move — the worker's new job is
      // to build. carrying / carriedKind reset to canonical zeros so
      // the hash slot stays clean.
      w.carrying = 0;
      w.carriedKind = 'energy';
      w.targetNodeId = 0;
      w.targetNodeSlot = 0;
      w.moveTarget = null;
      w.harvestTicksRemaining = 0;
      w.phase = 'movingToBuildSite';
      w.targetStructureId = newStructure.id;
      // Build supersedes any auto-resume memory.
      w.previousNodeId = 0;
      // Phase C.6.6: invalidate the cached A* route on retarget.
      w.path.length = 0;
      w.pathGoalTile = -1;
      return;
    }
    case CommandKind.AssignWorkerToBuild: {
      // Phase D-prep: assign a worker to FINISH an existing partial build.
      // Unlike BuildStructureByWorker this spawns nothing and re-pays no
      // Energy — the structure already exists (its build cost was paid at
      // placement); the worker simply adopts it and ticks it down on site.
      // This is the path that rescues a half-built pod whose original
      // builder was redirected to another task.
      const w = findUnit(state, cmd.workerId);
      if (w === null || !w.alive || w.kind !== 'worker') return;
      if (isInChargeMode(w)) return;
      if (w.charge < CHARGE_COST_PER_TASK) return;
      const s = findStructure(state, cmd.structureId);
      if (s === null || !s.alive) return;
      // Phase D.3: any worker-built structure (pod or depot) can be finished.
      if (s.faction !== w.faction) return;
      if (s.buildTicksRemaining <= 0) return; // already operational — nothing to finish
      // Pay the worker's charge (same per-task drain as any other order).
      w.charge -= CHARGE_COST_PER_TASK;
      // Drop any in-progress harvest / move — the worker's new job is to
      // build. carrying / carriedKind reset to canonical zeros so the hash
      // slot stays clean (mirrors BuildStructureByWorker).
      w.carrying = 0;
      w.carriedKind = 'energy';
      w.targetNodeId = 0;
      w.targetNodeSlot = 0;
      w.moveTarget = null;
      w.harvestTicksRemaining = 0;
      w.phase = 'movingToBuildSite';
      w.targetStructureId = s.id;
      // Build supersedes any auto-resume memory.
      w.previousNodeId = 0;
      // Phase C.6.6: invalidate the cached A* route on retarget.
      w.path.length = 0;
      w.pathGoalTile = -1;
      return;
    }
    case CommandKind.Resign: {
      // The resigning faction concedes; the other faction wins. No-op
      // if a winner is already set so a late Resign command in the
      // same frame as an HQ-destroy doesn't flip the result.
      if (state.winner !== null) return;
      state.winner = (1 - cmd.faction) as Faction;
      return;
    }
    case CommandKind.StartResearchAtPod: {
      // Research command (slot 14, reused across hosts). Routed by researchKind:
      //   - autoResume     → hosted at an operational WORK POD; single faction
      //                       slot (researchingKind), energy-only.
      //   - resourceTrickle→ hosted at an operational RESOURCE DEPOT; its own
      //                       INDEPENDENT track, so it can run in parallel with
      //                       autoResume (different building, resource-gated only).
      // Silent reject if the host is wrong / not operational, the track is
      // already in progress or complete, or the faction can't afford it.
      const s = findStructure(state, cmd.structureId);
      if (s === null || !s.alive) return;
      if (s.buildTicksRemaining > 0) return;
      const fs = state.factions[s.faction];
      if (cmd.researchKind === 'autoResume') {
        if (s.kind !== 'workPod') return;
        if (fs.researchingKind !== null) return;
        if (fs.autoResumeResearched) return;
        if (!canAfford(fs, { energy: RESEARCH_AUTO_RESUME_COST })) return;
        spendCost(fs, { energy: RESEARCH_AUTO_RESUME_COST });
        fs.researchingKind = 'autoResume';
        fs.researchTicksRemaining = RESEARCH_AUTO_RESUME_TICKS;
        return;
      }
      // resourceTrickle
      if (s.kind !== 'resourceDepot') return;
      if (fs.trickleResearched) return;
      if (fs.trickleResearchTicksRemaining > 0) return; // already in progress
      if (!canAfford(fs, RESEARCH_TRICKLE_COST)) return;
      spendCost(fs, RESEARCH_TRICKLE_COST);
      fs.trickleResearchTicksRemaining = RESEARCH_TRICKLE_TICKS;
      return;
    }
    case CommandKind.ScoutWorker: {
      // Phase C.6.8: send a worker to reveal fog. Scouting is exploration /
      // movement, not an energy-burning task, so it costs NO charge to run —
      // but it's still gated to a controllable worker: one in charge mode (or
      // at 0 charge, i.e. one that needs charging) silently rejects. Because
      // no charge is drained, a worker with as little as 1 charge can scout
      // and keeps that charge, so it never gets stranded at 0 mid-scout.
      // Pick the frontier FIRST: if the faction's map is already fully
      // revealed there's nothing to scout, so don't disturb the worker's task.
      const w = findUnit(state, cmd.workerId);
      if (w === null || !w.alive || w.kind !== 'worker') return;
      if (isInChargeMode(w)) return;
      if (w.charge < CHARGE_COST_PER_TASK) return;
      const target = findNearestUnexploredTile(state, w.faction, w.x, w.y);
      if (target < 0) return; // fully revealed — no-op
      const c = tileCenter(target, state.gridSize);
      w.moveTarget = { x: c.x, y: c.y };
      w.phase = 'scouting';
      // Drop any harvest / build assignment — scouting is the new task.
      // carrying is intentionally left untouched (same as MoveUnit): a
      // worker scouting mid-haul keeps its cargo to deposit later.
      w.targetNodeId = 0;
      w.targetNodeSlot = 0;
      w.harvestTicksRemaining = 0;
      w.targetStructureId = 0;
      // Scouting supersedes any auto-resume memory.
      w.previousNodeId = 0;
      // Phase C.6.6: invalidate the cached A* route on retarget.
      w.path.length = 0;
      w.pathGoalTile = -1;
      return;
    }
  }
}

// Phase C.6.8: nearest tile NOT yet explored by `faction`, as a packed tile
// index (ty*gridSize+tx), or -1 if the faction's map is fully revealed.
// Pure scan of the explored bitmap — never reads node positions, so the AI
// can't "cheat" toward undiscovered resources; it only knows where the fog
// is, not what's under it. Deterministic: nearest by squared distance, ties
// broken by lowest packed index.
function findNearestUnexploredTile(
  state: SimState,
  faction: Faction,
  x: Fixed,
  y: Fixed,
): number {
  const g = state.gridSize;
  const explored = state.explored[faction];
  let best = -1;
  let bestD: Fixed = 0;
  for (let ty = 0; ty < g; ty++) {
    const rowBase = ty * g;
    const tcy = fromInt(ty);
    for (let tx = 0; tx < g; tx++) {
      const idx = rowBase + tx;
      if (explored[idx] === 1) continue;
      const d = distSq(x, y, fromInt(tx), tcy);
      if (best < 0 || d < bestD || (d === bestD && idx < best)) {
        best = idx;
        bestD = d;
      }
    }
  }
  return best;
}

// Phase C.1/D.3 — end-of-step: tick down each faction's in-flight research and
// flip the matching completion flag. Two INDEPENDENT tracks advance in parallel:
//   - the autoResume single slot (researchingKind), hosted at a pod.
//   - the resourceTrickle track (its own ticks counter), hosted at a depot.
function advanceResearch(state: SimState): void {
  for (const fs of state.factions) {
    // autoResume single slot.
    if (fs.researchingKind !== null) {
      fs.researchTicksRemaining -= 1;
      if (fs.researchTicksRemaining <= 0) {
        switch (fs.researchingKind) {
          case 'autoResume':
            fs.autoResumeResearched = true;
            break;
          case 'resourceTrickle':
            // Not hosted on this slot — defensive no-op.
            break;
        }
        fs.researchingKind = null;
        fs.researchTicksRemaining = 0;
      }
    }
    // resourceTrickle independent track.
    if (!fs.trickleResearched && fs.trickleResearchTicksRemaining > 0) {
      fs.trickleResearchTicksRemaining -= 1;
      if (fs.trickleResearchTicksRemaining <= 0) {
        fs.trickleResearched = true;
        fs.trickleResearchTicksRemaining = 0;
      }
    }
  }
}

// Phase D.3 — passive resource trickle. Once a faction has researched it, every
// OPERATIONAL depot it owns credits DEPOT_TRICKLE_AMOUNT of both energy and
// matter into the faction pool every DEPOT_TRICKLE_INTERVAL_TICKS, routed
// through creditDeposit so the harvested score spine lifts exactly as a worker
// offload would. Fires on the interval boundary (tick % interval === 0);
// deterministic (integer tick modulo, fixed-point amounts).
function advanceTrickle(state: SimState): void {
  if (state.tick % DEPOT_TRICKLE_INTERVAL_TICKS !== 0) return;
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.kind !== 'resourceDepot') continue;
    if (s.buildTicksRemaining > 0) continue;
    const fs = state.factions[s.faction];
    if (!fs.trickleResearched) continue;
    creditDeposit(fs, 'energy', DEPOT_TRICKLE_AMOUNT);
    creditDeposit(fs, 'matter', DEPOT_TRICKLE_AMOUNT);
  }
}

// Phase C.2 — production pass. Ticks the head of each faction's worker
// queue down; on completion spawns the unit at its reserved tile and
// advances the queue. Runs in faction-index order (0 then 1) so
// nextEntityId assignment stays deterministic regardless of command
// merge order.
function advanceProduction(state: SimState): void {
  for (let f = 0; f < 2; f++) {
    const fs = state.factions[f];
    if (fs.trainQueue.length === 0) continue;
    fs.trainTicksRemaining -= 1;
    if (fs.trainTicksRemaining > 0) continue;
    const item = fs.trainQueue.shift();
    if (item === undefined) continue;
    spawnUnit(state, item.kind, f as Faction, item.x, item.y);
    fs.trainTicksRemaining = fs.trainQueue.length > 0
      ? unitStatsFor(fs.factionId, fs.trainQueue[0].kind).trainTicks
      : 0;
  }
}

// Pick the lowest-index unused harvest slot for a worker about to be
// assigned to `nodeId`. Excludes the worker itself (so re-assigning to
// the same node doesn't see the worker's own old slot as taken). Falls
// back to slot 0 if all are taken — surplus workers stack on slot 0.
function pickHarvestSlot(state: SimState, nodeId: number, selfId: number): number {
  const used: boolean[] = [false, false, false, false, false, false];
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive || u.kind !== 'worker') continue;
    if (u.id === selfId) continue;
    if (u.targetNodeId !== nodeId) continue;
    const s = u.targetNodeSlot;
    if (s >= 0 && s < HARVEST_SLOT_COUNT) used[s] = true;
  }
  for (let s = 0; s < HARVEST_SLOT_COUNT; s++) {
    if (!used[s]) return s;
  }
  return 0;
}

// Pick the lowest-index unused formation slot for a MoveUnit landing at
// (tx, ty). Slot 0 is the centre; 1..N take the surrounding ring offsets.
function pickFormationSlot(state: SimState, tx: Fixed, ty: Fixed, selfId: number): number {
  const used: boolean[] = [];
  for (let s = 0; s < FORMATION_SLOT_COUNT; s++) used.push(false);
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive) continue;
    if (u.id === selfId) continue;
    if (u.moveTarget === null) continue;
    for (let s = 0; s < FORMATION_SLOT_COUNT; s++) {
      const off = FORMATION_OFFSETS[s];
      const cx = add(tx, off.dx);
      const cy = add(ty, off.dy);
      if (distSq(u.moveTarget.x, u.moveTarget.y, cx, cy) <= WORKER_REACH_SQ) {
        used[s] = true;
        break;
      }
    }
  }
  for (let s = 0; s < FORMATION_SLOT_COUNT; s++) {
    if (!used[s]) return s;
  }
  return 0;
}

// Chebyshev step-toward-target. clampStep clips a per-axis delta to
// ±limit; moveTowards returns a new (x, y) one chebyshev step closer to
// (tx, ty) — each axis moves up to `speed`, capped at the remaining
// delta. No sqrt; no normalisation; no per-unit velocity stored.
function clampStep(delta: Fixed, speed: Fixed): Fixed {
  if (delta === 0) return 0;
  if (delta > 0) return delta < speed ? delta : speed;
  const negSpeed = -speed;
  return delta > negSpeed ? delta : negSpeed;
}

function moveTowards(
  curX: Fixed,
  curY: Fixed,
  tx: Fixed,
  ty: Fixed,
  speed: Fixed,
): { x: Fixed; y: Fixed } {
  const dx = sub(tx, curX);
  const dy = sub(ty, curY);
  return { x: add(curX, clampStep(dx, speed)), y: add(curY, clampStep(dy, speed)) };
}

// Phase C.6.6 — A* tile-blocking radii (squared), all < the spacing that would
// catch a neighbouring tile, so each blocker occupies exactly its own tile(s):
//   - work pod: 0.7 → its single tile only. The pod mesh is now 0.85 wide on a
//     1.0 tile (WORK_POD_SCALE in meshes.ts), so it can't overlap a neighbour;
//     two pods on adjacent tiles form a genuine 2-tile wall A* routes around,
//     and two pods left a tile apart leave a real, passable gap.
//   - energy node: 0.95 → its single tile.
//   - HQ: 1.95 → its 3×3 footprint (the HQ mesh genuinely spans several tiles).
const HQ_PATH_BLOCK_SQ: Fixed = rangeSq(fromFloat(1.95));
const POD_PATH_BLOCK_SQ: Fixed = rangeSq(fromFloat(0.7));
const NODE_PATH_BLOCK_SQ: Fixed = rangeSq(fromFloat(0.95));
// Phase D.3: the depot's 2×2 footprint. Measured from the centre (which sits on
// a tile boundary, +0.5), each of the 4 footprint tile centres is √0.5 ≈ 0.707
// away and the nearest non-footprint tile centre is ≥ 1.5 away, so a 1.0 radius
// blocks exactly the 4 footprint tiles and leaves the surrounding tiles passable.
const DEPOT_PATH_BLOCK_SQ: Fixed = rangeSq(fromFloat(1.0));

// Blocker key for a faction's HQ (HQs aren't entities in any array, so they
// can't use an entity id). Negative to never collide with positive ids / 0.
function hqKey(faction: 0 | 1): number {
  return -(faction + 1);
}

// Gather the static blockers a worker must route around: both HQs, every
// operational work pod, and every alive energy node. Built once per tick and
// shared across the unit-advance pass. Each carries a stable `key` so a
// worker's own destination can be exempted by identity. Order is deterministic
// (HQ0, HQ1, structures, nodes — array order).
function collectBlockers(state: SimState): PathBlocker[] {
  const blockers: PathBlocker[] = [
    { x: state.factions[0].hqX, y: state.factions[0].hqY, pathRadiusSq: HQ_PATH_BLOCK_SQ, key: hqKey(0) },
    { x: state.factions[1].hqX, y: state.factions[1].hqY, pathRadiusSq: HQ_PATH_BLOCK_SQ, key: hqKey(1) },
  ];
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive || s.buildTicksRemaining > 0) continue; // operational structures only
    // Phase D.3: pods occupy 1 tile, depots their 2×2 footprint.
    const radiusSq = s.kind === 'resourceDepot' ? DEPOT_PATH_BLOCK_SQ : POD_PATH_BLOCK_SQ;
    blockers.push({ x: s.x, y: s.y, pathRadiusSq: radiusSq, key: s.id });
  }
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (!n.alive) continue;
    // Phase D.2 hybrid blocking: a node blocks pathfinding ONLY if it's a true
    // standalone single — no other alive node within Chebyshev 1. A *clustered*
    // node (≥1 adjacent/diagonal node neighbour) is walk-through, so the dense
    // interior of an organic blob stays harvestable (it would otherwise be
    // unreachable — A* can't enter and workers can't cross the surrounding
    // nodes). Recomputed from alive nodes each tick, so a cluster picked down to
    // its last survivor sees that survivor become solid again. See docs/plan.md
    // "Phase D.2 — Pathfinding".
    if (nodeIsStandalone(state.nodes, i)) {
      blockers.push({ x: n.x, y: n.y, pathRadiusSq: NODE_PATH_BLOCK_SQ, key: n.id });
    }
  }
  return blockers;
}

// Chebyshev-1 neighbour threshold for "is this node part of a cluster?". Nodes
// sit on integer tiles, so this is exact equality at 1 tile (FIXED_ONE).
const NODE_CLUSTER_NEIGHBOUR: Fixed = FIXED_ONE;

// True iff node `idx` has NO alive node neighbour within Chebyshev 1 — i.e. it's
// a standalone single (and therefore a pathfinding blocker per the D.2 rule).
// Pure over the node array; exported for the cluster-pathing test.
export function nodeIsStandalone(nodes: SimState['nodes'], idx: number): boolean {
  const a = nodes[idx];
  if (!a.alive) return false;
  for (let j = 0; j < nodes.length; j++) {
    if (j === idx) continue;
    const b = nodes[j];
    if (!b.alive) continue;
    if (
      abs(sub(a.x, b.x)) <= NODE_CLUSTER_NEIGHBOUR &&
      abs(sub(a.y, b.y)) <= NODE_CLUSTER_NEIGHBOUR
    ) {
      return false;
    }
  }
  return true;
}

// The blocker key the worker is allowed to walk into — its current destination
// (the node it harvests, the HQ it deposits at, the pod/HQ it charges at, the
// structure it builds). Exemption is by identity so a *different* blocker next
// to the destination still blocks the route. A plain idle move targets a free
// tile → nothing exempt.
function targetExemptKey(w: Worker): number {
  switch (w.phase) {
    case 'movingToNode':
    case 'harvesting':
      return w.targetNodeId;
    case 'returning':
      // Phase D.3: exempt the locked offload target — the depot (its id is a
      // blocker) or the HQ (key 0 → hqKey) so A* can route right up to it.
      return w.depositTargetStructureId !== 0 ? w.depositTargetStructureId : hqKey(w.faction);
    case 'movingToBuildSite':
    case 'building':
      return w.targetStructureId;
    case 'walkingToCharge':
    case 'charging':
      return w.chargeTargetStructureId !== 0 ? w.chargeTargetStructureId : hqKey(w.faction);
    case 'idle':
    case 'scouting':
      // Scouting always targets a free, unexplored tile — nothing to exempt.
      return NO_EXEMPT;
  }
}

// Distance² at which a worker is "at" a path waypoint and pops it.
const WAYPOINT_REACH_SQ: Fixed = rangeSq(fromFloat(0.3));

// Pure-A* navigation: follow a cached waypoint route, no steering.
//
// Two targets are passed:
//   - (planX,planY): the route target A* plans to — the destination blocker's
//     CENTRE (exempt by key, so always reachable). The raw harvest/charge SLOT
//     can sit on a tile an adjacent pod blocks, which A* couldn't reach, so we
//     never plan straight to it.
//   - (steerX,steerY): the precise sub-tile point the worker finally settles
//     on — walked to directly (plain straight step) once the route is done.
// For a plain move (and HQ / build, where slot == centre) the two coincide.
//
// The path is cached on the worker and recomputed ONLY when the destination
// tile changes (no per-tick revalidation) — cheap, and A* fires only on (re)
// assignment / phase transition. The final straight step has no obstacle
// awareness: it may clip a footprint on the last sub-tile hop, but it never
// oscillates or stalls. Deterministic: a pure function of hashed state.
function navigate(
  state: SimState,
  w: Worker,
  planX: Fixed,
  planY: Fixed,
  steerX: Fixed,
  steerY: Fixed,
  speed: Fixed,
  blockers: ReadonlyArray<PathBlocker>,
): { x: Fixed; y: Fixed } {
  const g = state.gridSize;
  const goalTile = packTile(tileAxis(planX, g), tileAxis(planY, g), g);
  if (w.pathGoalTile !== goalTile) {
    w.path = findPath(w.x, w.y, planX, planY, g, blockers, targetExemptKey(w));
    w.pathGoalTile = goalTile;
  }
  // Drop reached waypoints, then step toward the next one — or the real
  // sub-tile target on the final leg once the path is exhausted.
  while (w.path.length > 0) {
    const c = tileCenter(w.path[0], g);
    if (distSq(w.x, w.y, c.x, c.y) <= WAYPOINT_REACH_SQ) {
      w.path.shift();
    } else {
      return moveTowards(w.x, w.y, c.x, c.y, speed);
    }
  }
  return moveTowards(w.x, w.y, steerX, steerY, speed);
}

function advanceWorker(state: SimState, w: Worker, blockers: ReadonlyArray<PathBlocker>): void {
  const factionId = state.factions[w.faction].factionId;
  const speed = unitStatsFor(factionId, 'worker').speed;
  const harvestInterval = factionConfigFor(factionId).harvestTicks;

  // Pre-check: an IDLE worker at 0 charge transitions into charge mode
  // immediately. Mid-task workers are intentionally NOT pre-empted —
  // the C.1 rule is "always complete the current task before charging"
  // (energy was drained at task-start, so the worker has nothing more
  // to spend even if it's mid-cycle). End-of-task code paths call
  // maybeEnterChargeMode directly.
  //
  // Scouting can't strand a worker at 0 charge: it costs no charge to run
  // (see the ScoutWorker command) and is gated to ≥1 charge at start, so a
  // scout always keeps the charge it had and stays controllable (redirectable
  // by any command, which all require ≥1 charge).
  if (w.charge === 0 && w.phase === 'idle') {
    maybeEnterChargeMode(state, w);
  }

  switch (w.phase) {
    case 'idle':
      // Idle workers walk to a manual move target if one is set, then
      // park there (moveTarget stays set so auto-assign skips them).
      if (w.moveTarget !== null) {
        const tgt = w.moveTarget;
        if (distSq(w.x, w.y, tgt.x, tgt.y) <= WORKER_REACH_SQ) {
          w.x = tgt.x;
          w.y = tgt.y;
          return;
        }
        // Plain move to a free tile — plan and steer coincide.
        const next = navigate(state, w, tgt.x, tgt.y, tgt.x, tgt.y, speed, blockers);
        w.x = next.x;
        w.y = next.y;
      }
      return;

    case 'scouting': {
      // Head toward the nearest unexplored tile, revealing fog en route
      // (advanceExploration marks a vision disc around the worker each
      // tick). Re-pick whenever the current target has been revealed —
      // by our own approach or another friendly unit — so the scout
      // always walks toward live fog and never trudges onto an
      // already-uncovered tile. When no unexplored tile remains, the
      // faction's map is fully revealed → the scout's job is done.
      //
      // Reachability note: a target the A* can't reach still gets
      // revealed once the worker closes within vision radius (4 tiles),
      // which flips it explored and triggers a re-pick — so a single
      // 1-tile blocker (node/pod) never strands the scout. The only way
      // to truly trap it is a fog pocket walled off ≥ vision-radius thick
      // on every side, which the scattered 1-tile blockers on these maps
      // can't form.
      const g = state.gridSize;
      let needPick = w.moveTarget === null;
      if (!needPick && w.moveTarget !== null) {
        const tt = packTile(tileAxis(w.moveTarget.x, g), tileAxis(w.moveTarget.y, g), g);
        if (state.explored[w.faction][tt] === 1) needPick = true;
      }
      if (needPick) {
        const nextTile = findNearestUnexploredTile(state, w.faction, w.x, w.y);
        if (nextTile < 0) {
          w.moveTarget = null;
          w.phase = 'idle';
          maybeEnterChargeMode(state, w);
          return;
        }
        const c = tileCenter(nextTile, g);
        w.moveTarget = { x: c.x, y: c.y };
        w.path.length = 0;
        w.pathGoalTile = -1;
      }
      const tgt = w.moveTarget;
      if (tgt === null) return; // unreachable given the re-pick above; satisfies the type narrow
      const next = navigate(state, w, tgt.x, tgt.y, tgt.x, tgt.y, speed, blockers);
      w.x = next.x;
      w.y = next.y;
      return;
    }

    case 'movingToNode': {
      const node = findNode(state, w.targetNodeId);
      if (!node) {
        // Node depleted or disappeared mid-walk — task is dropped.
        // Energy was already drained at task-start, so no refund.
        w.phase = 'idle';
        w.targetNodeId = 0;
        w.targetNodeSlot = 0;
        maybeEnterChargeMode(state, w);
        return;
      }
      const slot = HARVEST_SLOT_OFFSETS[w.targetNodeSlot % HARVEST_SLOT_COUNT];
      const slotX = add(node.x, slot.dx);
      const slotY = add(node.y, slot.dy);
      // Plan to the node centre (exempt, always reachable); settle on the slot.
      const next = navigate(state, w, node.x, node.y, slotX, slotY, speed, blockers);
      w.x = next.x;
      w.y = next.y;
      if (distSq(w.x, w.y, slotX, slotY) <= WORKER_REACH_SQ) {
        w.phase = 'harvesting';
        w.harvestTicksRemaining = harvestInterval;
        w.x = slotX;
        w.y = slotY;
      }
      return;
    }

    case 'harvesting': {
      const node = findNode(state, w.targetNodeId);
      if (!node) {
        w.phase = 'idle';
        w.targetNodeId = 0;
        w.targetNodeSlot = 0;
        maybeEnterChargeMode(state, w);
        return;
      }
      w.harvestTicksRemaining -= 1;
      if (w.harvestTicksRemaining <= 0) {
        const taken = node.remaining < HARVEST_AMOUNT ? node.remaining : HARVEST_AMOUNT;
        const carry = w.carrying + taken < WORKER_CAPACITY ? w.carrying + taken : WORKER_CAPACITY;
        const actuallyTaken = carry - w.carrying;
        node.remaining = sub(node.remaining, actuallyTaken);
        w.carrying = carry;
        w.carriedKind = node.kind;
        if (node.remaining <= 0) node.alive = false;
        if (actuallyTaken === 0) {
          w.phase = 'idle';
          w.targetNodeId = 0;
          w.targetNodeSlot = 0;
          maybeEnterChargeMode(state, w);
          return;
        }
        // Phase D.3: lock in the offload target (nearest of HQ / depots) now.
        enterReturning(state, w);
      }
      return;
    }

    case 'returning': {
      const fs = state.factions[w.faction];
      // Phase D.3: resolve the locked offload point — a depot (the stall fix)
      // or the HQ — with the correct arrival reach for whichever it is.
      const dep = resolveDeposit(state, w);
      const nextRet = navigate(state, w, dep.x, dep.y, dep.x, dep.y, speed, blockers);
      w.x = nextRet.x;
      w.y = nextRet.y;
      if (distSq(w.x, w.y, dep.x, dep.y) <= dep.reachSq) {
        // Credit the deposit (pool + harvested score spine) through the shared
        // helper — identical whether offloaded at the HQ or a depot.
        creditDeposit(fs, w.carriedKind, w.carrying);
        w.carrying = 0;
        w.carriedKind = 'energy';
        w.depositTargetStructureId = 0;
        // End of harvest cycle — task complete. Decide what's next:
        // (a) charge depleted? walkingToCharge.
        // (b) charge OK + node still alive? auto-continue cycle (which
        //     costs another charge — re-check + drain).
        // (c) otherwise idle.
        if (w.charge < CHARGE_COST_PER_TASK) {
          // Drop the target and go charge.
          w.phase = 'idle';
          w.targetNodeId = 0;
          w.targetNodeSlot = 0;
          maybeEnterChargeMode(state, w);
          return;
        }
        const node = findNode(state, w.targetNodeId);
        if (node) {
          // Auto-continue the cycle — pay the energy now (drain at
          // start of next cycle).
          w.charge -= CHARGE_COST_PER_TASK;
          w.phase = 'movingToNode';
        } else {
          w.phase = 'idle';
          w.targetNodeId = 0;
          w.targetNodeSlot = 0;
          maybeEnterChargeMode(state, w);
        }
      }
      return;
    }

    case 'movingToBuildSite': {
      const s = findStructure(state, w.targetStructureId);
      if (s === null || !s.alive || s.buildTicksRemaining <= 0) {
        // Structure depleted (already operational) or destroyed mid-walk.
        w.phase = 'idle';
        w.targetStructureId = 0;
        maybeEnterChargeMode(state, w);
        return;
      }
      const next = navigate(state, w, s.x, s.y, s.x, s.y, speed, blockers);
      w.x = next.x;
      w.y = next.y;
      // Phase D.3: the 2×2 depot uses a wider on-site reach than the 1×1 pod.
      const buildReachSq = s.kind === 'resourceDepot' ? DEPOT_BUILD_REACH_SQ : WORK_POD_BUILD_REACH_SQ;
      if (distSq(w.x, w.y, s.x, s.y) <= buildReachSq) {
        w.phase = 'building';
      }
      return;
    }

    case 'building': {
      const s = findStructure(state, w.targetStructureId);
      if (s === null || !s.alive || s.buildTicksRemaining <= 0) {
        w.phase = 'idle';
        w.targetStructureId = 0;
        maybeEnterChargeMode(state, w);
        return;
      }
      // Tick the structure down. Multi-worker construction stacks here
      // naturally: every worker on site (its own builder plus any assigned
      // via AssignWorkerToBuild) decrements once per tick, so N builders
      // finish the pod ~N× faster. The `<= 0` guard above means a late
      // builder this tick sees the pod already done and bails without
      // driving buildTicksRemaining negative.
      s.buildTicksRemaining -= 1;
      if (s.buildTicksRemaining <= 0) {
        w.phase = 'idle';
        w.targetStructureId = 0;
        maybeEnterChargeMode(state, w);
      }
      return;
    }

    case 'walkingToCharge': {
      // Pick / re-pick the charge spot every tick — a pod completing
      // construction mid-walk should redirect this worker to it. When
      // the target id changes, re-pick the slot too (different spot's
      // table; the old slot index doesn't translate).
      const target = pickChargeTarget(state, w);
      if (target.structureId !== w.chargeTargetStructureId) {
        w.chargeTargetStructureId = target.structureId;
        w.chargeSlot = pickChargeSlot(state, w.faction, target.structureId, w.id);
      }
      const slotPos = chargeSlotPosition(target.x, target.y, target.structureId, w.chargeSlot);
      // Plan to the charge-spot centre (exempt); settle on the charge slot.
      const next = navigate(state, w, target.x, target.y, slotPos.x, slotPos.y, speed, blockers);
      w.x = next.x;
      w.y = next.y;
      if (distSq(w.x, w.y, slotPos.x, slotPos.y) <= WORKER_REACH_SQ) {
        // Snap to slot for a bit-stable resting position regardless
        // of approach trajectory.
        w.x = slotPos.x;
        w.y = slotPos.y;
        w.phase = 'charging';
        w.chargeTicksAccrued = 0;
      }
      return;
    }

    case 'charging': {
      // Charge rate depends on whether the spot is a pod or HQ. The HQ
      // fallback is 50% the pod rate per the C.1 spec.
      const podSpotId = w.chargeTargetStructureId;
      const isPod = podSpotId !== 0;
      // Validate the chosen spot is still operational; if not, fall
      // back to re-walking (walkingToCharge will pick a new target).
      if (isPod) {
        const pod = findStructure(state, podSpotId);
        if (pod === null || !pod.alive || pod.buildTicksRemaining > 0) {
          w.phase = 'walkingToCharge';
          w.chargeTicksAccrued = 0;
          return;
        }
      }
      w.chargeTicksAccrued += 1;
      const rate = isPod ? CHARGE_TICKS_PER_UNIT_POD : CHARGE_TICKS_PER_UNIT_HQ;
      if (w.chargeTicksAccrued >= rate) {
        w.chargeTicksAccrued = 0;
        w.charge += 1;
        if (w.charge >= w.maxCharge) {
          w.charge = w.maxCharge;
          // Fully charged — return to idle, available for commands.
          // Clear charge-spot state so the slot frees for the next
          // worker that needs it.
          w.phase = 'idle';
          w.chargeTargetStructureId = 0;
          w.chargeSlot = 0;
          // Phase C.1 auto-resume: re-engage the previous harvest if
          // the faction has the research + the node is still alive.
          maybeAutoResumeAfterCharge(state, w);
        }
      }
      return;
    }
  }
}

function advanceUnit(state: SimState, u: Unit, blockers: ReadonlyArray<PathBlocker>): void {
  if (!u.alive) return;
  advanceWorker(state, u, blockers);
}

// Phase C.6.10: maintain each worker's stalled-idle counter. Runs AFTER the
// advance pass so it reads each worker's settled phase for this tick. A worker
// parked at `idle` with nothing pending (no move target) is doing nothing
// useful → its counter climbs; any active phase or a pending move zeroes it.
// The AI reads this to decide when an idle worker has waited long enough
// (with no discovered node to harvest) to be worth dispatching as a scout.
function updateIdleTimers(state: SimState): void {
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive || u.kind !== 'worker') continue;
    if (u.phase === 'idle' && u.moveTarget === null) {
      if (u.idleTicks < 0x7fffffff) u.idleTicks += 1;
    } else {
      u.idleTicks = 0;
    }
  }
}

// Phase C.1: structure advance. Build-phase progress is on the worker
// side (`building` phase). This pass is a no-op for now but exists so
// future per-tick structure activity (combat HP regen, etc.) has a
// home.
function advanceStructure(_state: SimState, _s: Structure): void {
  // Intentionally empty.
}

// Phase C.1: recompute each faction's supplyCap + supplyUsed at end of
// step. supplyCap = HQ baseline + WORK_POD_CAP_BONUS × operational pods.
// supplyUsed = count of alive friendly workers. The recompute lands
// AFTER advance passes so a pod completing build this tick is reflected
// on next tick's TrainUnit checks.
function recomputeSupplyCaps(state: SimState): void {
  const podBonus: [number, number] = [0, 0];
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.kind !== 'workPod') continue;
    if (s.buildTicksRemaining > 0) continue;
    podBonus[s.faction] += WORK_POD_CAP_BONUS;
  }
  const used: [number, number] = [0, 0];
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive) continue;
    used[u.faction] += 1;
  }
  state.factions[0].supplyCap = HQ_SUPPLY_CAP_INITIAL + podBonus[0];
  state.factions[1].supplyCap = HQ_SUPPLY_CAP_INITIAL + podBonus[1];
  state.factions[0].supplyUsed = used[0];
  state.factions[1].supplyUsed = used[1];
}

function advanceDiscovery(state: SimState): void {
  const markFromPoint = (faction: Faction, x: Fixed, y: Fixed, rSq: Fixed): void => {
    for (let i = 0; i < state.nodes.length; i++) {
      const n = state.nodes[i];
      if (n.discoveredBy[faction]) continue;
      const d = distSq(x, y, n.x, n.y);
      if (d <= rSq) n.discoveredBy[faction] = true;
    }
  };

  const hqRadSq = rangeSq(HQ_VISION_RADIUS);
  for (const f of [0, 1] as const) {
    const fs = state.factions[f];
    markFromPoint(f, fs.hqX, fs.hqY, hqRadSq);
  }

  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive) continue;
    markFromPoint(u.faction, u.x, u.y, rangeSq(UNIT_STATS[u.kind].visionRadius));
  }

  // Phase C.1/D.3: operational structures (pods + depots) project vision the
  // same way HQs do, each with its own vision radius.
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.buildTicksRemaining > 0) continue;
    markFromPoint(s.faction, s.x, s.y, rangeSq(STRUCTURE_STATS[s.kind].visionRadius));
  }
}

// Phase C.6.7: tile-level exploration sweep — the same vision sources as
// advanceDiscovery (HQ + alive units + operational pods), but marking the
// per-faction explored TILE set rather than node flags. Permanent reveal
// (markExploredCircle never clears a set tile). This is the deterministic
// fog the AI scouts against (C.6.8+) and the render paints from. Kept as a
// separate pass from advanceDiscovery so the node-discovery path the AI
// already relies on is untouched (additive change → identical behaviour).
function advanceExploration(state: SimState): void {
  const g = state.gridSize;
  for (const f of [0, 1] as const) {
    const fs = state.factions[f];
    markExploredCircle(state.explored[f], g, fs.hqX, fs.hqY, HQ_VISION_RADIUS);
  }
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive) continue;
    markExploredCircle(state.explored[u.faction], g, u.x, u.y, UNIT_STATS[u.kind].visionRadius);
  }
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.buildTicksRemaining > 0) continue;
    markExploredCircle(state.explored[s.faction], g, s.x, s.y, STRUCTURE_STATS[s.kind].visionRadius);
  }
}

function checkWinner(state: SimState): SimState['winner'] {
  // HQ destruction takes priority — the canonical win path. Stays the
  // only reachable end when matchLengthTicks is 0 (tests, tutorial,
  // determinism-gate scripted matches).
  if (state.factions[1].hqHp <= 0) return 0;
  if (state.factions[0].hqHp <= 0) return 1;
  // Scored economic match (opt-in via spec.matchLengthTicks). Ends at the
  // buzzer, or early if the whole field is mined out — higher score wins
  // with a deterministic tie-break (see decideScoreWinner). checkWinner
  // runs with state.tick == the tick just processed (pre-increment), so
  // testing `tick + 1 >= matchLengthTicks` makes the timer trip on the
  // last gameplay tick of the configured window.
  if (state.matchLengthTicks > 0) {
    const timeUp = state.tick + 1 >= state.matchLengthTicks;
    if (timeUp || fieldExhausted(state)) return decideScoreWinner(state);
  }
  return null;
}

// "The whole node field has been mined out." Workers may still be hauling
// a final load, so the check holds off while any worker carries cargo —
// otherwise an early-end would deny the worker its last deposit (and the
// score it earned). Empty-node specs (used in win.test.ts BASIC_SPEC and
// other minimal fixtures) never qualify as exhausted — there was nothing
// to mine in the first place.
function fieldExhausted(state: SimState): boolean {
  if (state.nodes.length === 0) return false;
  for (let i = 0; i < state.nodes.length; i++) {
    if (state.nodes[i].alive) return false;
  }
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (u.alive && u.carrying > 0) return false;
  }
  return true;
}

export function step(state: SimState, rng: Rng, frame: InputFrame): void {
  if (frame.tick !== state.tick) {
    throw new Error(`step: input frame tick ${frame.tick} != state tick ${state.tick}`);
  }

  if (state.winner === null) {
    for (let i = 0; i < frame.commands.length; i++) {
      applyCommand(state, frame.commands[i]);
    }
    // Phase C.2: spawn any units whose train timer elapses this tick
    // before the advance pass, so a just-popped worker is included in
    // this tick's iteration (idle, no-op) and the end-of-step supply
    // recompute.
    advanceProduction(state);
    // Phase C.6.6: snapshot the static blockers once per tick so every worker
    // plans against the same set (a pod completing build this tick becomes a
    // blocker next tick — its builder targets it, so it's exempt anyway).
    const blockers = collectBlockers(state);
    for (let i = 0; i < state.units.length; i++) {
      advanceUnit(state, state.units[i], blockers);
    }
    updateIdleTimers(state);
    for (let i = 0; i < state.structures.length; i++) {
      advanceStructure(state, state.structures[i]);
    }
    recomputeSupplyCaps(state);
    advanceResearch(state);
    advanceTrickle(state);
    advanceDiscovery(state);
    advanceExploration(state);
    if (state.winner === null) {
      state.winner = checkWinner(state);
    }
  }

  state.tick += 1;
  state.rngState = rng.snapshot();
}
