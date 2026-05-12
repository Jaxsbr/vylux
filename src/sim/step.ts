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
//   6. Win-condition check (HQ destruction); preserves a winner already
//      set by an in-frame Resign command.
//   7. Bump tick counter, mirror RNG state.
//
// Mutation is in-place. The renderer never sees mid-step state because
// the renderer pulls from sim only between ticks.
//
// Phase C.1 (2026-05-12): workers carry per-unit charge. Each task
// drains 1 at task-start. Movement is free while charge > 0; a worker
// at charge === 0 enters charge mode (walkingToCharge → charging) and
// refuses all player commands until full recharge. Charge spots are
// (1) the nearest friendly operational work pod, or (2) the friendly
// HQ if no pod exists. The HQ recharges at 50% the pod rate.

import { Rng } from './rng';
import { CommandKind, type Command, type InputFrame } from './commands';
import {
  findNearestFriendlyOperationalWorkPod,
  findNode,
  findStructure,
  findUnit,
  spawnStructure,
  spawnUnit,
} from './state';
import {
  type Faction,
  type SimState,
  type Structure,
  type Unit,
  type Worker,
} from './types';
import { add, distSq, fromFloat, fromInt, rangeSq, sub, type Fixed } from './fixed';
import {
  CHARGE_TICKS_PER_UNIT_HQ,
  CHARGE_TICKS_PER_UNIT_POD,
  ENERGY_COST_PER_TASK,
  HQ_CHARGE_SLOT_COUNT,
  HQ_CHARGE_SLOT_OFFSETS,
  HQ_SUPPLY_CAP_INITIAL,
  HQ_VISION_RADIUS,
  POD_CHARGE_SLOT_COUNT,
  POD_CHARGE_SLOT_OFFSETS,
  RESEARCH_AUTO_RESUME_COST,
  RESEARCH_AUTO_RESUME_TICKS,
  STRUCTURE_STATS,
  UNIT_STATS,
  WORK_POD_BUILD_REACH_SQ,
  WORK_POD_CAP_BONUS,
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

// Phase C.1: charge-spot picking. Always prefer the nearest friendly
// operational work pod; fall back to the friendly HQ only if no pod
// exists. The chosen spot's structure id is recorded on
// `chargeTargetStructureId` (0 = HQ since HQs aren't entities in the
// structures array; the faction-on-worker disambiguates which HQ).
function pickChargeTarget(state: SimState, w: Worker): { x: Fixed; y: Fixed; structureId: number } {
  const pod = findNearestFriendlyOperationalWorkPod(state, w.faction, w.x, w.y);
  if (pod !== null) {
    return { x: pod.x, y: pod.y, structureId: pod.id };
  }
  const fs = state.factions[w.faction];
  return { x: fs.hqX, y: fs.hqY, structureId: 0 };
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
  if (w.charge < ENERGY_COST_PER_TASK) return;
  // Resume — same shape as applyCommand AssignWorkerToNode, minus the
  // command path. We're spending a fresh charge to start the cycle.
  w.charge -= ENERGY_COST_PER_TASK;
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
      // floating "needs energy" lightning cue when this filter trips.
      if (isInChargeMode(u)) return;
      if (u.charge < ENERGY_COST_PER_TASK) return;
      // Phase C.1: drain at TASK START. One harvest cycle = 1 energy.
      // The deduction lands now (not at deposit) so an aborted cycle
      // costs the player the same as a completed one.
      u.charge -= ENERGY_COST_PER_TASK;
      // Pick a harvest slot before binding the worker to the node —
      // counted across all currently-assigned workers, so a multi-worker
      // fan-out (player click on node with 3 workers selected → 3
      // sequential AssignWorkerToNode commands in one frame) gets slots
      // 0, 1, 2 picked in order.
      u.targetNodeSlot = pickHarvestSlot(state, n.id, u.id);
      u.targetNodeId = n.id;
      u.phase = u.carrying > 0 ? 'returning' : 'movingToNode';
      // Any node-assign command supersedes a manual park.
      u.moveTarget = null;
      // Dropping any pending build assignment if there was one (would
      // already have refunded the energy charge at start).
      u.targetStructureId = 0;
      // The player issued an explicit harvest — that's the new "previous
      // task" for auto-resume purposes (replacing any older one).
      u.previousNodeId = n.id;
      return;
    }
    case CommandKind.TrainUnit: {
      const stats = UNIT_STATS[cmd.unitKind];
      const fs = state.factions[cmd.faction];
      if (fs.energy < stats.trainCost) return;
      // Phase C.1: supply cap gate. supplyUsed is recomputed at end of
      // each step so reads stable here. Train command is silently
      // rejected when the cap is full.
      if (fs.supplyUsed >= fs.supplyCap) return;
      fs.energy = sub(fs.energy, stats.trainCost);
      // Spawn at the given tile if provided (player click-to-place);
      // otherwise at the HQ perimeter via round-robin offset.
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
      spawnUnit(state, cmd.unitKind, cmd.faction, spawnX, spawnY);
      // supplyUsed is recomputed at end of step; bumping inline here
      // would make subsequent same-tick TrainUnit commands see a stale
      // cap. The "one train per AI tick" pattern keeps this from being
      // a problem in practice, but if you ever want burst-spawn the
      // recompute pass is where this would land.
      return;
    }
    case CommandKind.MoveUnit: {
      const u = findUnit(state, cmd.unitId);
      if (!u) return;
      // Phase C.1: a worker at 0 charge (or in charge mode) refuses
      // move orders too. Per the answer to open Q3 — moves are free
      // while energy exists, but a depleted worker is fully locked
      // until recharge.
      if (u.kind === 'worker' && (isInChargeMode(u) || u.charge < ENERGY_COST_PER_TASK)) return;
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
      if (w.charge < ENERGY_COST_PER_TASK) return;
      const fs = state.factions[w.faction];
      const stats = STRUCTURE_STATS[cmd.structureKind];
      if (fs.energy < stats.buildCost) return;
      // Pay the Energy + the worker's charge atomically — both fail
      // together, or both apply together.
      fs.energy = sub(fs.energy, stats.buildCost);
      w.charge -= ENERGY_COST_PER_TASK;
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
      // Phase C.1 research command. Faction-level slot — silent reject
      // if (a) the named structure isn't a friendly operational pod,
      // (b) the faction is already mid-research, (c) the research kind
      // is already complete, or (d) the faction can't afford it.
      const s = findStructure(state, cmd.structureId);
      if (s === null || !s.alive) return;
      if (s.kind !== 'workPod') return;
      if (s.buildTicksRemaining > 0) return;
      const fs = state.factions[s.faction];
      if (fs.researchingKind !== null) return;
      if (cmd.researchKind === 'autoResume' && fs.autoResumeResearched) return;
      // Cost lookup (one entry for now; switch grows as more research
      // kinds land).
      const cost = cmd.researchKind === 'autoResume' ? RESEARCH_AUTO_RESUME_COST : 0;
      const ticks = cmd.researchKind === 'autoResume' ? RESEARCH_AUTO_RESUME_TICKS : 0;
      if (fs.energy < cost) return;
      fs.energy = sub(fs.energy, cost);
      fs.researchingKind = cmd.researchKind;
      fs.researchTicksRemaining = ticks;
      return;
    }
  }
}

// Phase C.1 — end-of-step: tick down any in-flight research and flip
// the corresponding faction-level flag on completion. Single-slot per
// faction so a faction can hold at most one mid-research at a time.
function advanceResearch(state: SimState): void {
  for (const fs of state.factions) {
    if (fs.researchingKind === null) continue;
    fs.researchTicksRemaining -= 1;
    if (fs.researchTicksRemaining > 0) continue;
    switch (fs.researchingKind) {
      case 'autoResume':
        fs.autoResumeResearched = true;
        break;
    }
    fs.researchingKind = null;
    fs.researchTicksRemaining = 0;
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

function advanceWorker(state: SimState, w: Worker): void {
  const factionId = state.factions[w.faction].factionId;
  const speed = unitStatsFor(factionId, 'worker').speed;
  const harvestInterval = factionConfigFor(factionId).harvestTicks;

  // Pre-check: an IDLE worker at 0 charge transitions into charge mode
  // immediately. Mid-task workers are intentionally NOT pre-empted —
  // the C.1 rule is "always complete the current task before charging"
  // (energy was drained at task-start, so the worker has nothing more
  // to spend even if it's mid-cycle). End-of-task code paths call
  // maybeEnterChargeMode directly.
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
        const next = moveTowards(w.x, w.y, tgt.x, tgt.y, speed);
        w.x = next.x;
        w.y = next.y;
      }
      return;

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
      const next = moveTowards(w.x, w.y, slotX, slotY, speed);
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
        w.phase = 'returning';
      }
      return;
    }

    case 'returning': {
      const hq = state.factions[w.faction];
      const nextRet = moveTowards(w.x, w.y, hq.hqX, hq.hqY, speed);
      w.x = nextRet.x;
      w.y = nextRet.y;
      if (distSq(w.x, w.y, hq.hqX, hq.hqY) <= HQ_DEPOSIT_REACH_SQ) {
        hq.energy = add(hq.energy, w.carrying);
        w.carrying = 0;
        w.carriedKind = 'energy';
        // End of harvest cycle — task complete. Decide what's next:
        // (a) charge depleted? walkingToCharge.
        // (b) charge OK + node still alive? auto-continue cycle (which
        //     costs another charge — re-check + drain).
        // (c) otherwise idle.
        if (w.charge < ENERGY_COST_PER_TASK) {
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
          w.charge -= ENERGY_COST_PER_TASK;
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
      const next = moveTowards(w.x, w.y, s.x, s.y, speed);
      w.x = next.x;
      w.y = next.y;
      if (distSq(w.x, w.y, s.x, s.y) <= WORK_POD_BUILD_REACH_SQ) {
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
      // Tick the structure down. Multi-worker construction would stack
      // here naturally, but C.1 ships single-worker for simplicity.
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
      const next = moveTowards(w.x, w.y, slotPos.x, slotPos.y, speed);
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

function advanceUnit(state: SimState, u: Unit): void {
  if (!u.alive) return;
  advanceWorker(state, u);
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

  // Phase C.1: operational work pods project vision the same way HQs do.
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.kind !== 'workPod') continue;
    if (s.buildTicksRemaining > 0) continue;
    markFromPoint(s.faction, s.x, s.y, rangeSq(STRUCTURE_STATS.workPod.visionRadius));
  }
}

function checkWinner(state: SimState): SimState['winner'] {
  if (state.factions[1].hqHp <= 0) return 0;
  if (state.factions[0].hqHp <= 0) return 1;
  return null;
}

export function step(state: SimState, rng: Rng, frame: InputFrame): void {
  if (frame.tick !== state.tick) {
    throw new Error(`step: input frame tick ${frame.tick} != state tick ${state.tick}`);
  }

  if (state.winner === null) {
    for (let i = 0; i < frame.commands.length; i++) {
      applyCommand(state, frame.commands[i]);
    }
    for (let i = 0; i < state.units.length; i++) {
      advanceUnit(state, state.units[i]);
    }
    for (let i = 0; i < state.structures.length; i++) {
      advanceStructure(state, state.structures[i]);
    }
    recomputeSupplyCaps(state);
    advanceResearch(state);
    advanceDiscovery(state);
    if (state.winner === null) {
      state.winner = checkWinner(state);
    }
  }

  state.tick += 1;
  state.rngState = rng.snapshot();
}
