// One tick of the simulation. Pure-by-convention — given the same state
// and same inputs, mutates state to the same result every time.
//
// Step ordering (load-bearing for determinism):
//   1. Apply all input commands in given order (deterministic dispatch).
//   2. Advance units by kind + state, in array-index order.
//      - Workers: harvest/return loop.
//      - Defenders: attack-in-range only.
//      - Raiders: move toward enemy HQ + attack-in-range.
//   3. (Future) periodic mechanics: node regen, AI tick.
//   4. Bump tick counter, mirror RNG state.
//
// Mutation is in-place. The renderer never sees mid-step state because
// the renderer pulls from sim only between ticks.
//
// Targeting tiebreaker: lowest entity ID. This is a convention, not a
// design choice — anything stable works, but the existing array-index
// iteration plus lowest-ID-wins gives us trivially deterministic
// targeting without needing a sort.

import { Rng } from './rng';
import { CommandKind, type Command, type InputFrame } from './commands';
import { findNode, findStructure, findTrail, findUnit, spawnStructure, spawnTrail, spawnUnit } from './state';
import {
  FACTION_COLOR,
  type Defender,
  type Faction,
  type Raider,
  type ResourceNode,
  type SimState,
  type Structure,
  type Trail,
  type Unit,
  type Vanguard,
  type Worker,
} from './types';
import {
  add,
  distSq,
  fromFloat,
  fromInt,
  rangeSq,
  sub,
  type Fixed,
} from './fixed';
import {
  DUMP_COOLDOWN_TICKS,
  DUMP_DURATION_TICKS,
  DUMP_ENERGY_COST,
  DUMP_SPEED_MULTIPLIER,
  HQ_VISION_RADIUS,
  STRUCTURE_STATS,
  SUPPLY_CAP_BONUS_PER_PYLON,
  SUPPLY_CAP_INITIAL,
  TIER2_COLOR_COST,
  TIER2_FLUX_COST,
  TIER2_RESEARCH_TICKS,
  TRAIL_DURATION_FLUX_COST,
  TRAIL_DURATION_RESEARCH_TICKS,
  TRAIL_KILL_RANGE_SQ,
  TRAIL_SEGMENT_LIFETIME,
  UNIT_STATS,
} from './units-config';

// Worker-loop tuning still lives here for now. Per-kind stats moved to
// units-config.ts; these are loop-shape constants that don't fit there.
export const WORKER_REACH_SQ: Fixed = rangeSq(fromFloat(0.06));
export const HARVEST_TICKS = 20; // 1 second at 20 Hz
export const HARVEST_AMOUNT: Fixed = fromInt(5);
export const WORKER_CAPACITY: Fixed = fromInt(5);

// Phase 3.10.4: HQ-perimeter spawn offsets for newly-trained workers.
// Eight surrounding tiles, ordered to spread sequential spawns around
// the HQ rather than stacking on one side. The faction's
// nextSpawnRotation indexes into this table.
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

// Phase 3.10.5: workers stop at the HQ perimeter (don't walk into the
// 3.9.3-bumped HQ silhouette to deposit). Threshold is in tile-units²
// — 2.0² gives an arrival ring just outside the HQ visual.
export const HQ_DEPOSIT_REACH_SQ: Fixed = rangeSq(fromFloat(2.0));

// Phase 3.10.6: how close a worker must be to the structure tile to
// count as "on site" and contribute to construction progress.
export const BUILD_REACH_SQ: Fixed = rangeSq(fromFloat(1.2));

// Phase 3.10.9 — widened harvest-arrival radius so workers cluster
// naturally around a node instead of all trying to occupy its centre.
// The original WORKER_REACH_SQ (0.06²) is preserved as the snap-to-
// node "I'm exactly here" check; this looser radius is the
// "close-enough-to-start-harvesting" gate. Independently useful and
// kept across the 2026-05-08 revert of the soft-collision pass — a
// worker bounced slightly off the node centre still picks up the
// harvest, which 3.10.10's velocity-based steering will rely on.
export const HARVEST_AT_NODE_REACH_SQ: Fixed = rangeSq(fromFloat(0.55));

// Win conditions: HQ destruction only (post-2026-05-07 PvE pivot).
// The previous POINTS_PER_KILL / POINTS_PER_HQ_HIT / WIN_POINTS
// constants and the per-faction `points` field have been removed —
// they were esport-balance scaffolding for a "first to threshold wins"
// 1v1 path that doesn't fit the PvE direction. Wave-survival +
// scenario objective + boss win conditions land in sub-phase 3.13.

export function applyCommand(state: SimState, cmd: Command): void {
  switch (cmd.kind) {
    case CommandKind.Noop:
      return;
    case CommandKind.AssignWorkerToNode: {
      const u = findUnit(state, cmd.workerId);
      if (!u || u.kind !== 'worker') return;
      const n = findNode(state, cmd.nodeId);
      if (!n) return;
      // Phase 3.5: faction colour lock. Workers can't be assigned to
      // the opponent's colour node — silent reject so a tampered
      // client can't cheat its way onto a forbidden node, and so the
      // input layer doesn't have to filter exhaustively (it's correct
      // by construction here).
      if (!canHarvest(u.faction, n)) return;
      u.targetNodeId = n.id;
      u.phase = u.carrying > 0 ? 'returning' : 'movingToNode';
      // Phase 3.3: any node-assign command supersedes a manual park.
      u.moveTarget = null;
      return;
    }
    case CommandKind.SpawnUnit: {
      spawnUnit(state, cmd.unitKind, cmd.faction, fromInt(cmd.x), fromInt(cmd.y));
      // Phase 3.6: dev-only SpawnUnit still consumes supply so tests
      // that exercise the death-decrement path see realistic state.
      state.factions[cmd.faction].supplyUsed += UNIT_STATS[cmd.unitKind].supplyCost;
      return;
    }
    case CommandKind.TrainUnit: {
      // Phase 3.0 rule: HQ trains workers only (PRD §6.4). Combat units
      // must be trained at a production building via TrainAtStructure.
      // Silently reject combat-kind invocations rather than crash; a
      // mis-routed UI command shouldn't end the match. The constraint
      // lives in the sim so a tampered client can't bypass it without
      // desyncing.
      if (cmd.unitKind !== 'worker') return;
      const stats = UNIT_STATS[cmd.unitKind];
      const fs = state.factions[cmd.faction];
      if (fs.energy < stats.trainCost) return;
      // Phase 3.5: colour gate. Workers cost 5 colour by default —
      // small enough that the SPEC's initialColor pre-fund covers the
      // opening worker batch, large enough that a faction with no
      // colour pool can't bootstrap out of a denial.
      if (fs.color < stats.trainColorCost) return;
      // Phase 3.6: supply gate. Sim-enforced so a tampered client can't
      // spam over-cap (would desync immediately).
      if (fs.supplyUsed + stats.supplyCost > fs.supplyCap) return;
      // The spawn is instant (workers train at HQ with trainTicks=0),
      // so reserving and consuming collapse to one bump.
      fs.supplyUsed += stats.supplyCost;
      fs.energy = sub(fs.energy, stats.trainCost);
      if (stats.trainColorCost > 0) fs.color = sub(fs.color, stats.trainColorCost);
      // Spawn at the given tile if provided (player click-to-place);
      // otherwise at the HQ perimeter (Phase 3.10.4 — workers no longer
      // appear inside the HQ silhouette where they're hard to select).
      // Round-robin offset by faction.nextSpawnRotation so consecutive
      // trains spread around the HQ instead of stacking.
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
      return;
    }
    case CommandKind.BuildStructure: {
      // Phase 3.10.6: legacy command kept for back-compat + test
      // setup. Spawns the structure with `builtByWorker = false` so
      // advanceStructure auto-ticks the build phase as it always did.
      // Player + AI use BuildStructureByWorker for the real workflow.
      const fs = state.factions[cmd.faction];
      const stats = STRUCTURE_STATS[cmd.structureKind];
      if (fs.energy < stats.buildCost) return;
      if (fs.color < stats.buildColorCost) return;
      fs.energy = sub(fs.energy, stats.buildCost);
      if (stats.buildColorCost > 0) fs.color = sub(fs.color, stats.buildColorCost);
      spawnStructure(state, cmd.structureKind, cmd.faction, fromInt(cmd.x), fromInt(cmd.y));
      return;
    }
    case CommandKind.TrainAtStructure: {
      const s = findStructure(state, cmd.structureId);
      if (s === null) return;
      if (s.kind !== 'production') return;
      if (s.buildTicksRemaining > 0) return; // not yet operational
      if (s.trainingKind !== null) return; // already training; single-slot in 3.0
      const stats = UNIT_STATS[cmd.unitKind];
      const fs = state.factions[s.faction];
      // Phase 3.2: tier-2 units gate on faction.tier2Researched. The
      // gate lives in the sim so the rule is determinism-load-bearing
      // — same anti-cheat-by-construction posture as TrainUnit's
      // workers-only restriction.
      if (stats.requiresTier2 && !fs.tier2Researched) return;
      if (fs.energy < stats.trainCost) return;
      if (fs.flux < stats.trainFluxCost) return;
      // Phase 3.5: colour gate.
      if (fs.color < stats.trainColorCost) return;
      // Phase 3.6: supply gate. Reserved at queue time, not at spawn
      // time — otherwise the player could queue a vanguard knowing it
      // would slip past the cap by the time training completes. The
      // queued unit also takes the supply slot for the duration of
      // training; if the cap drops mid-train (Pylon dying), the unit
      // still spawns and pushes supplyUsed over the cap (existing
      // units are never auto-killed for supply reasons).
      if (fs.supplyUsed + stats.supplyCost > fs.supplyCap) return;
      fs.energy = sub(fs.energy, stats.trainCost);
      if (stats.trainFluxCost > 0) fs.flux = sub(fs.flux, stats.trainFluxCost);
      if (stats.trainColorCost > 0) fs.color = sub(fs.color, stats.trainColorCost);
      // Reserve the supply slot now so a follow-up TrainAtStructure
      // command on a different building can't double-book.
      fs.supplyUsed += stats.supplyCost;
      s.trainingKind = cmd.unitKind;
      s.trainTicksRemaining = stats.trainTicks;
      return;
    }
    case CommandKind.MoveUnit: {
      // Phase 3.3: manual move-order. Defenders silently no-op
      // (stationary). Workers drop any harvest target and park at the
      // destination — moveTarget stays set after arrival so the auto-
      // assign-idle sweep won't pick them up. Raiders + vanguards take
      // the destination as a temporary HQ-march override; their advance
      // function clears moveTarget on arrival.
      const u = findUnit(state, cmd.unitId);
      if (!u) return;
      if (u.kind === 'defender') return;
      const tx = fromInt(cmd.x);
      const ty = fromInt(cmd.y);
      u.moveTarget = { x: tx, y: ty };
      if (u.kind === 'worker') {
        u.phase = 'idle';
        u.targetNodeId = 0;
        u.harvestTicksRemaining = 0;
      }
      return;
    }
    case CommandKind.ResearchTier2AtStructure: {
      // Phase 3.2: structure-gated tier-2 research. Replaces 3.1's
      // standalone ResearchTier2 path. The faction must have a built,
      // idle upgrade structure to research at; the research itself is
      // time-gated (sets researchTicksRemaining; the upgrade structure's
      // advance hook flips the faction flag on completion).
      const s = findStructure(state, cmd.structureId);
      if (s === null) return;
      if (s.kind !== 'upgrade') return;
      if (s.buildTicksRemaining > 0) return; // not yet operational
      if (s.researchTicksRemaining > 0) return; // already researching
      const fs = state.factions[s.faction];
      if (fs.tier2Researched) return; // already done
      if (fs.flux < TIER2_FLUX_COST) return;
      // Phase 3.5: tier-2 research costs colour too.
      if (fs.color < TIER2_COLOR_COST) return;
      fs.flux = sub(fs.flux, TIER2_FLUX_COST);
      fs.color = sub(fs.color, TIER2_COLOR_COST);
      s.researchTicksRemaining = TIER2_RESEARCH_TICKS;
      // Phase 3.7: tag the active research kind so the completion
      // dispatch in advanceStructure knows which faction-level flag
      // to flip. Cleared back to null on completion.
      s.researchKind = 'tier2';
      return;
    }
    case CommandKind.ActivateEnergyDump: {
      // Phase 3.7: only workers can dump. Defence-in-depth: the UI
      // only emits dump commands for selected workers, but the sim is
      // the source of truth.
      const u = findUnit(state, cmd.workerId);
      if (!u || u.kind !== 'worker') return;
      if (u.dumpTicksRemaining > 0) return; // already dumping
      if (u.dumpCooldownTicks > 0) return; // on cooldown
      const fs = state.factions[u.faction];
      if (fs.energy < DUMP_ENERGY_COST) return;
      fs.energy = sub(fs.energy, DUMP_ENERGY_COST);
      // Spawn a fresh trail entity for this dump activation. Each
      // activation gets its own trail so multiple workers dumping
      // simultaneously don't share a segment list.
      const trail = spawnTrail(state, u.faction);
      u.activeTrailId = trail.id;
      u.dumpTicksRemaining = DUMP_DURATION_TICKS;
      // Cooldown counter starts at dump-end (not dump-start) so the
      // player gets the full cooldown after the ability finishes.
      // dumpCooldownTicks stays at 0 here.
      return;
    }
    case CommandKind.ResearchTrailDurationAtStructure: {
      // Phase 3.7: structure-gated trail-duration research. Same
      // shape as ResearchTier2AtStructure but checks + sets the
      // trail-duration flag instead of tier-2.
      const s = findStructure(state, cmd.structureId);
      if (s === null) return;
      if (s.kind !== 'upgrade') return;
      if (s.buildTicksRemaining > 0) return; // not yet operational
      if (s.researchTicksRemaining > 0) return; // already researching
      const fs = state.factions[s.faction];
      if (fs.trailDurationResearched) return; // already done
      if (fs.flux < TRAIL_DURATION_FLUX_COST) return;
      fs.flux = sub(fs.flux, TRAIL_DURATION_FLUX_COST);
      s.researchTicksRemaining = TRAIL_DURATION_RESEARCH_TICKS;
      s.researchKind = 'trailDuration';
      return;
    }
    case CommandKind.BuildStructureByWorker: {
      // Phase 3.10.6: worker-driven build. Spawns the structure +
      // assigns the named worker to walk to it and construct it. Cost
      // deducted at command time so the resource commitment is visible
      // to the player on click — same shape as BuildStructure but the
      // structure is inert (buildTicksRemaining stays at full) until a
      // worker arrives at the site.
      const w = findUnit(state, cmd.workerId);
      if (w === null || !w.alive || w.kind !== 'worker') return;
      const fs = state.factions[w.faction];
      const stats = STRUCTURE_STATS[cmd.structureKind];
      if (fs.energy < stats.buildCost) return;
      if (fs.color < stats.buildColorCost) return;
      fs.energy = sub(fs.energy, stats.buildCost);
      if (stats.buildColorCost > 0) fs.color = sub(fs.color, stats.buildColorCost);
      const newStructure = spawnStructure(
        state,
        cmd.structureKind,
        w.faction,
        fromInt(cmd.x),
        fromInt(cmd.y),
      );
      // Phase 3.10.6: this structure waits for the worker — its build
      // phase only ticks down when a worker is on site (advanceWorker
      // Phase 'building'). Without this flag advanceStructure would
      // auto-tick the build, defeating the purpose.
      newStructure.builtByWorker = true;
      // Drop any in-progress harvest / move; the worker's new job is
      // to build. carriedKind reset to canonical so the hash slot
      // stays clean (mirrors the on-deposit + on-death resets).
      w.carrying = 0;
      w.carriedKind = 'energy';
      w.targetNodeId = 0;
      w.moveTarget = null;
      w.harvestTicksRemaining = 0;
      w.phase = 'building';
      w.targetStructureId = newStructure.id;
      return;
    }
    case CommandKind.AssignWorkerToBuild: {
      // Phase 3.10.7: another worker joins an in-progress build. No
      // cost — the structure already paid; this just stacks build
      // throughput.
      const w = findUnit(state, cmd.workerId);
      if (w === null || !w.alive || w.kind !== 'worker') return;
      const s = findStructure(state, cmd.structureId);
      if (s === null || !s.alive) return;
      if (s.faction !== w.faction) return; // can't help an enemy build
      if (s.buildTicksRemaining <= 0) return; // already operational
      w.carrying = 0;
      w.carriedKind = 'energy';
      w.targetNodeId = 0;
      w.moveTarget = null;
      w.harvestTicksRemaining = 0;
      w.phase = 'building';
      w.targetStructureId = s.id;
      return;
    }
  }
}

// Phase 3.5: faction-colour harvest gate. Energy + Flux are anyone-
// harvest; colour nodes only by the matching faction. Centralised here
// so applyCommand and advanceWorker share one source of truth.
function canHarvest(faction: Faction, node: ResourceNode): boolean {
  if (node.kind === 'blue' || node.kind === 'red') {
    return node.kind === FACTION_COLOR[faction];
  }
  return true;
}

// Phase 3.5: passive node regen toward maxReserve. Energy + Flux nodes
// have regenPerTick === 0 so this is a no-op for them; colour nodes
// heal a small amount each tick. Capped so the value can't drift past
// the ceiling. Dead nodes are skipped — energy/flux nodes that died at
// empty stay dead (they have no regen to revive them); colour nodes
// don't die at empty so they stay alive and recover here.
function advanceNode(node: ResourceNode): void {
  if (!node.alive) return;
  if (node.regenPerTick === 0) return;
  if (node.remaining >= node.maxReserve) return;
  const next = add(node.remaining, node.regenPerTick);
  node.remaining = next > node.maxReserve ? node.maxReserve : next;
}

function moveTowards(
  curX: Fixed,
  curY: Fixed,
  tx: Fixed,
  ty: Fixed,
  speed: Fixed,
): { x: Fixed; y: Fixed } {
  // Chebyshev-style step: move on each axis up to speed, capped at the
  // remaining delta. No sqrt; no normalisation; deterministic by
  // construction.
  const dx = sub(tx, curX);
  const dy = sub(ty, curY);
  return { x: add(curX, clampStep(dx, speed)), y: add(curY, clampStep(dy, speed)) };
}

function clampStep(delta: Fixed, speed: Fixed): Fixed {
  if (delta === 0) return 0;
  if (delta > 0) return delta < speed ? delta : speed;
  const negSpeed = -speed;
  return delta > negSpeed ? delta : negSpeed;
}

// Find the nearest live enemy unit within range. Tiebreaker: lowest ID.
// Returns null if nothing in range.
function findNearestEnemyInRange(
  state: SimState,
  attacker: Unit,
  rangeSquared: Fixed,
): Unit | null {
  let best: Unit | null = null;
  let bestDistSq: Fixed = 0;

  for (let i = 0; i < state.units.length; i++) {
    const candidate = state.units[i];
    if (!candidate.alive) continue;
    if (candidate.faction === attacker.faction) continue;

    const d = distSq(attacker.x, attacker.y, candidate.x, candidate.y);
    if (d > rangeSquared) continue;

    if (best === null || d < bestDistSq || (d === bestDistSq && candidate.id < best.id)) {
      best = candidate;
      bestDistSq = d;
    }
  }
  return best;
}

// Apply damage to a unit. Returns true if the target died as a result.
// Caller signature stays Unit-only — supply-decrement on death is done
// here rather than in the caller because every code path that kills a
// unit goes through applyDamage; centralising guarantees supplyUsed
// can never drift over time.
function applyDamage(state: SimState, target: Unit, damage: Fixed): boolean {
  target.hp = sub(target.hp, damage);
  if (target.hp <= 0) {
    target.alive = false;
    target.hp = 0;
    // Workers carrying energy lose it on death — no salvage. Phase 1
    // economic balance question; leave as a simple rule for now.
    if (target.kind === 'worker') {
      target.carrying = 0;
      target.carriedKind = 'energy'; // canonical reset for determinism
      target.phase = 'idle';
      target.targetNodeId = 0;
      // Phase 3.7: reset dump fields to canonical zero. The trail this
      // worker spawned (if any) keeps existing — segments will age out
      // on their own. activeTrailId is just a back-reference for new
      // segment-append; clearing it stops any further appends if the
      // worker dies mid-dump.
      target.dumpTicksRemaining = 0;
      target.dumpCooldownTicks = 0;
      target.activeTrailId = 0;
      // Phase 3.10.6: clear build-task back-ref so the dead worker's
      // hash slot is canonical. The structure stays in build phase
      // until another worker is sent to it (no progress = waiting).
      target.targetStructureId = 0;
    }
    // Phase 3.3: clear move-order on death so the dead-unit field is in
    // a canonical state for the hash. Tombstones are kept (alive=false)
    // and moveTarget would otherwise carry historical state into the
    // hash forever.
    target.moveTarget = null;
    // Phase 3.6: free up the supply slot. supplyUsed is allowed to
    // exceed supplyCap (e.g., after a Pylon is destroyed); the
    // accounting still has to track the death so a future Pylon
    // re-build correctly accounts.
    state.factions[target.faction].supplyUsed -= UNIT_STATS[target.kind].supplyCost;
    return true;
  }
  return false;
}

// Apply HQ damage and clamp at zero. The OTHER faction wins when this
// hits 0 (handled by checkWinner). Post-pivot the points side-effect
// has been removed; only the HP transfer remains.
function damageEnemyHq(state: SimState, attacker: Raider, damage: Fixed): void {
  const enemyFaction: 0 | 1 = attacker.faction === 0 ? 1 : 0;
  const target = state.factions[enemyFaction];
  target.hqHp = sub(target.hqHp, damage);
  if (target.hqHp <= 0) {
    target.hqHp = 0;
  }
}

interface AttackOutcome {
  // True if the attacker has a valid target in range — fired or not.
  // Movement-capable units (raiders) hold position while engaged, so
  // they don't walk past their target while on cooldown.
  engaged: boolean;
  // True if the attacker fired this tick (started a new cooldown).
  fired: boolean;
}

function tryAttack(state: SimState, attacker: Defender | Raider | Vanguard): AttackOutcome {
  const stats = UNIT_STATS[attacker.kind];
  if (stats.attackDamage === 0) return { engaged: false, fired: false };

  const target = findNearestEnemyInRange(state, attacker, rangeSq(stats.attackRange));

  if (attacker.attackCooldown > 0) {
    attacker.attackCooldown -= 1;
    return { engaged: target !== null, fired: false };
  }
  if (!target) return { engaged: false, fired: false };

  applyDamage(state, target, stats.attackDamage);
  attacker.attackCooldown = stats.attackCooldownTicks;
  return { engaged: true, fired: true };
}

// Find nearest enemy structure in attack range. Tiebreaker: lowest ID.
// Returns null if nothing in range. Structures are stationary, so this
// degenerates to "structure overlapping range," but the same shape as
// unit targeting keeps the priority chain readable.
function findNearestEnemyStructureInRange(
  state: SimState,
  attacker: Unit,
  rangeSquared: Fixed,
): Structure | null {
  let best: Structure | null = null;
  let bestDistSq: Fixed = 0;
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction === attacker.faction) continue;
    const d = distSq(attacker.x, attacker.y, s.x, s.y);
    if (d > rangeSquared) continue;
    if (best === null || d < bestDistSq || (d === bestDistSq && s.id < best.id)) {
      best = s;
      bestDistSq = d;
    }
  }
  return best;
}

// Raiders treat enemy production buildings as attackable targets that
// sit between unit-combat and HQ-fallback priority. Killing one denies
// the opponent's combat-unit production until they rebuild — the
// economic-disruption shape PRD §6.4 + §6.5 commit to.
function tryAttackEnemyStructure(state: SimState, attacker: Raider): boolean {
  const stats = UNIT_STATS[attacker.kind];
  if (stats.attackDamage === 0) return false;
  const target = findNearestEnemyStructureInRange(state, attacker, rangeSq(stats.attackRange));
  if (target === null) return false;
  if (attacker.attackCooldown > 0) {
    attacker.attackCooldown -= 1;
    return true; // engaged with structure; hold position
  }
  target.hp = sub(target.hp, stats.attackDamage);
  if (target.hp <= 0) {
    target.alive = false;
    target.hp = 0;
  }
  attacker.attackCooldown = stats.attackCooldownTicks;
  return true;
}

// Raiders fall back to attacking the enemy HQ when no enemy unit is in
// range. Same range / cooldown rules as unit combat.
function tryAttackHq(state: SimState, raider: Raider): boolean {
  const stats = UNIT_STATS.raider;
  const enemyFaction: 0 | 1 = raider.faction === 0 ? 1 : 0;
  const enemy = state.factions[enemyFaction];

  const inRangeSq = rangeSq(stats.attackRange);
  const d = distSq(raider.x, raider.y, enemy.hqX, enemy.hqY);
  if (d > inRangeSq) return false;

  if (raider.attackCooldown > 0) {
    raider.attackCooldown -= 1;
    return true; // engaged with HQ; hold position
  }
  damageEnemyHq(state, raider, stats.attackDamage);
  raider.attackCooldown = stats.attackCooldownTicks;
  return true;
}

function advanceWorker(state: SimState, w: Worker): void {
  // Phase 3.7: dump book-keeping wraps the existing phase machine.
  // Snapshot `dumping` BEFORE phase logic so the post-step decrement
  // fires even when the phase code early-returns. Speed is doubled for
  // ALL movement paths (idle-with-moveTarget, movingToNode, returning)
  // while dumping — the dump's mobility is what makes it useful for
  // fleeing. A dumping worker still harvests at the normal cadence
  // (HARVEST_TICKS) because harvest is time-gated, not speed-gated.
  const dumping = w.dumpTicksRemaining > 0;
  advanceWorkerPhase(state, w, dumping);
  if (dumping) {
    // Append a segment at the worker's tick-end position so the trail
    // tracks the path actually taken. If the worker is dead by now
    // (killed mid-dump by an attacker), activeTrailId was reset to 0
    // by applyDamage so findTrail returns null and we skip cleanly.
    const trail = w.activeTrailId === 0 ? null : findTrail(state, w.activeTrailId);
    if (trail !== null) trail.segments.push({ x: w.x, y: w.y, age: 0 });
    w.dumpTicksRemaining -= 1;
    if (w.dumpTicksRemaining <= 0) {
      // Dump just ended this tick — start the cooldown counter and
      // detach from the trail (segments keep ageing on their own).
      w.dumpCooldownTicks = DUMP_COOLDOWN_TICKS;
      w.activeTrailId = 0;
    }
  } else if (w.dumpCooldownTicks > 0) {
    w.dumpCooldownTicks -= 1;
  }
}

function advanceWorkerPhase(state: SimState, w: Worker, dumping: boolean): void {
  const baseSpeed = UNIT_STATS.worker.speed;
  const speed = dumping ? (baseSpeed * DUMP_SPEED_MULTIPLIER) as Fixed : baseSpeed;
  switch (w.phase) {
    case 'idle':
      // Phase 3.3: idle workers walk to a manual move target if one is
      // set, then park there (moveTarget stays set so auto-assign skips
      // them). Without a move target, idle is genuine no-op.
      if (w.moveTarget !== null) {
        const tgt = w.moveTarget;
        if (distSq(w.x, w.y, tgt.x, tgt.y) <= WORKER_REACH_SQ) {
          // Snap to the integer tile centre so a parked worker has a
          // bit-stable position regardless of approach trajectory.
          w.x = tgt.x;
          w.y = tgt.y;
          return;
        }
        const nextPos = moveTowards(w.x, w.y, tgt.x, tgt.y, speed);
        w.x = nextPos.x;
        w.y = nextPos.y;
      }
      return;

    case 'movingToNode': {
      const node = findNode(state, w.targetNodeId);
      if (!node) {
        w.phase = 'idle';
        w.targetNodeId = 0;
        return;
      }
      const nextPos = moveTowards(w.x, w.y, node.x, node.y, speed);
      w.x = nextPos.x;
      w.y = nextPos.y;
      // Phase 3.10.9: workers transition to harvesting from the wider
      // HARVEST_AT_NODE_REACH_SQ so a worker bounced off the node centre
      // by the soft-collision pass still grabs the harvest. The narrow
      // WORKER_REACH_SQ (0.06²) is reserved for the post-deposit
      // movement target snap so a parked worker still has a bit-stable
      // integer-tile position.
      if (distSq(w.x, w.y, node.x, node.y) <= HARVEST_AT_NODE_REACH_SQ) {
        w.phase = 'harvesting';
        w.harvestTicksRemaining = HARVEST_TICKS;
      }
      return;
    }

    case 'harvesting': {
      const node = findNode(state, w.targetNodeId);
      if (!node) {
        w.phase = 'idle';
        w.targetNodeId = 0;
        return;
      }
      // Phase 3.5: a worker assigned (manually or otherwise) to a
      // foreign-colour node is silently re-idled here. AssignWorkerTo
      // Node already gates this at command time, but defence-in-depth
      // catches anything that slips through (e.g. a colour change
      // arriving via a different code path in a future sub-phase).
      if (!canHarvest(w.faction, node)) {
        w.phase = 'idle';
        w.targetNodeId = 0;
        return;
      }
      w.harvestTicksRemaining -= 1;
      if (w.harvestTicksRemaining <= 0) {
        const taken = node.remaining < HARVEST_AMOUNT ? node.remaining : HARVEST_AMOUNT;
        const carry = w.carrying + taken < WORKER_CAPACITY ? w.carrying + taken : WORKER_CAPACITY;
        const actuallyTaken = carry - w.carrying;
        node.remaining = sub(node.remaining, actuallyTaken);
        w.carrying = carry;
        // Phase 3.1: stamp the worker with the kind it just picked up
        // so the deposit step knows which faction pool to credit.
        // Workers don't switch resources mid-trip; once you're carrying
        // Flux (or colour), you walk it home before harvesting another
        // kind.
        w.carriedKind = node.kind;
        // Phase 3.5: only nodes with no regen die at empty. Colour
        // nodes stay alive at remaining=0 so passive regen can refill
        // them — losing them visually + permanently would defeat the
        // lockout-by-denial mechanic (the denied side could never
        // recover). Energy + Flux still die at empty (existing rule).
        if (node.remaining <= 0 && node.regenPerTick === 0) {
          node.alive = false;
        }
        // If the worker took nothing (depleted colour node), drop back
        // to idle so auto-assign can pick a different node next tick.
        // Without this the worker would deposit 0 at HQ and re-target
        // the same exhausted node forever.
        if (actuallyTaken === 0) {
          w.phase = 'idle';
          w.targetNodeId = 0;
          return;
        }
        w.phase = 'returning';
      }
      return;
    }

    case 'building': {
      // Phase 3.10.6: walk to the assigned structure tile; while
      // within BUILD_REACH_SQ, decrement its buildTicksRemaining each
      // tick. Multiple workers stack their decrements naturally
      // (each one fires once per tick). When the structure dies or
      // completes, drop back to idle.
      const s = findStructure(state, w.targetStructureId);
      if (s === null || !s.alive || s.buildTicksRemaining <= 0) {
        w.phase = 'idle';
        w.targetStructureId = 0;
        return;
      }
      const nextPos = moveTowards(w.x, w.y, s.x, s.y, speed);
      w.x = nextPos.x;
      w.y = nextPos.y;
      if (distSq(w.x, w.y, s.x, s.y) <= BUILD_REACH_SQ) {
        s.buildTicksRemaining -= 1;
        if (s.buildTicksRemaining <= 0) {
          // Build complete — release the worker. Other workers on the
          // same structure will also fall through this branch on their
          // own tick and release.
          w.phase = 'idle';
          w.targetStructureId = 0;
        }
      }
      return;
    }

    case 'returning': {
      const hq = state.factions[w.faction];
      const nextPos = moveTowards(w.x, w.y, hq.hqX, hq.hqY, speed);
      w.x = nextPos.x;
      w.y = nextPos.y;
      // Phase 3.10.5: deposit at the HQ perimeter, not the centre.
      // Old WORKER_REACH_SQ threshold was 0.06² — workers had to be
      // essentially on top of the HQ tile, which made them disappear
      // inside the bigger 3.9.3 HQ silhouette. HQ_DEPOSIT_REACH_SQ is
      // wider (2.0²) so the worker stops at the HQ edge instead.
      if (distSq(w.x, w.y, hq.hqX, hq.hqY) <= HQ_DEPOSIT_REACH_SQ) {
        // Phase 3.1 + 3.5: deposit to the pool matching the carried
        // kind. Colour kinds always credit faction.color (we'd never
        // get here carrying the opposite colour because canHarvest
        // gates assignment + harvest; defence-in-depth, but the
        // mismatch path would silently no-op the deposit rather than
        // crediting the wrong faction).
        if (w.carriedKind === 'flux') {
          hq.flux = add(hq.flux, w.carrying);
        } else if (w.carriedKind === 'blue' || w.carriedKind === 'red') {
          if (w.carriedKind === FACTION_COLOR[w.faction]) {
            hq.color = add(hq.color, w.carrying);
          }
        } else {
          hq.energy = add(hq.energy, w.carrying);
        }
        w.carrying = 0;
        // Reset to canonical 'energy' so determinism doesn't depend on
        // the historical sequence of carries.
        w.carriedKind = 'energy';
        const node = findNode(state, w.targetNodeId);
        if (node) {
          w.phase = 'movingToNode';
        } else {
          w.phase = 'idle';
          w.targetNodeId = 0;
        }
      }
      return;
    }
  }
}

function advanceDefender(state: SimState, d: Defender): void {
  // Defenders are stationary in Phase 1 — no movement. They only attack.
  tryAttack(state, d);
}

function advanceRaider(state: SimState, r: Raider): void {
  // Priority: enemy unit > enemy structure > enemy HQ > march. Holding
  // position when engaged (with anything) prevents the raider from
  // walking past its target while on cooldown.
  const outcome = tryAttack(state, r);
  if (outcome.engaged) return;

  if (tryAttackEnemyStructure(state, r)) return;

  if (tryAttackHq(state, r)) return;

  const stats = UNIT_STATS.raider;
  // Phase 3.3: manual move-target overrides the march-to-HQ default.
  // Combat checks above still preempt — engaged raiders ignore the
  // override until disengaged. On arrival, the override clears and the
  // raider resumes default behaviour next tick.
  if (r.moveTarget !== null) {
    const tgt = r.moveTarget;
    if (distSq(r.x, r.y, tgt.x, tgt.y) <= WORKER_REACH_SQ) {
      r.x = tgt.x;
      r.y = tgt.y;
      r.moveTarget = null;
      return;
    }
    const nextPos = moveTowards(r.x, r.y, tgt.x, tgt.y, stats.speed);
    r.x = nextPos.x;
    r.y = nextPos.y;
    return;
  }
  const enemyHq = state.factions[r.faction === 0 ? 1 : 0];
  const nextPos = moveTowards(r.x, r.y, enemyHq.hqX, enemyHq.hqY, stats.speed);
  r.x = nextPos.x;
  r.y = nextPos.y;
}

function advanceStructure(state: SimState, s: Structure): void {
  if (!s.alive) return;
  switch (s.kind) {
    case 'production': {
      // Phase 3.10.6: build-phase tick down only if NOT
      // worker-driven; worker-driven structures wait for
      // advanceWorkerPhase 'building' to decrement.
      if (s.buildTicksRemaining > 0) {
        if (!s.builtByWorker) s.buildTicksRemaining -= 1;
        return;
      }
      if (s.trainingKind !== null) {
        s.trainTicksRemaining -= 1;
        if (s.trainTicksRemaining <= 0) {
          spawnUnit(state, s.trainingKind, s.faction, s.x, s.y);
          s.trainingKind = null;
          s.trainTicksRemaining = 0;
        }
      }
      return;
    }
    case 'upgrade': {
      if (s.buildTicksRemaining > 0) {
        if (!s.builtByWorker) s.buildTicksRemaining -= 1;
        return;
      }
      if (s.researchTicksRemaining > 0) {
        s.researchTicksRemaining -= 1;
        if (s.researchTicksRemaining <= 0) {
          const fs = state.factions[s.faction];
          if (s.researchKind === 'tier2') fs.tier2Researched = true;
          else if (s.researchKind === 'trailDuration') fs.trailDurationResearched = true;
          s.researchKind = null;
        }
      }
      return;
    }
    case 'supply': {
      if (s.buildTicksRemaining > 0) {
        if (!s.builtByWorker) s.buildTicksRemaining -= 1;
      }
      return;
    }
  }
}

function advanceUnit(state: SimState, u: Unit): void {
  if (!u.alive) return;
  switch (u.kind) {
    case 'worker':
      advanceWorker(state, u);
      return;
    case 'defender':
      advanceDefender(state, u);
      return;
    case 'raider':
      advanceRaider(state, u);
      return;
    case 'vanguard':
      advanceVanguard(state, u);
      return;
  }
}

function advanceVanguard(state: SimState, v: Vanguard): void {
  // Phase 3.2 tier-2 unit. Same priority chain as a raider — enemy
  // unit > enemy structure > enemy HQ > march — but with vanguard's
  // own stats (longer range, more damage). Faction-divergent vanguard
  // behaviour (e.g. ground-pound area attacks, self-heal, etc.) is a
  // 3.4 design concern.
  const outcome = tryAttack(state, v);
  if (outcome.engaged) return;
  if (tryAttackEnemyStructureForUnit(state, v)) return;
  if (tryAttackHqForUnit(state, v)) return;
  const stats = UNIT_STATS.vanguard;
  // Phase 3.3: manual move-target overrides march; same shape as
  // advanceRaider. Combat preempts.
  if (v.moveTarget !== null) {
    const tgt = v.moveTarget;
    if (distSq(v.x, v.y, tgt.x, tgt.y) <= WORKER_REACH_SQ) {
      v.x = tgt.x;
      v.y = tgt.y;
      v.moveTarget = null;
      return;
    }
    const nextPos = moveTowards(v.x, v.y, tgt.x, tgt.y, stats.speed);
    v.x = nextPos.x;
    v.y = nextPos.y;
    return;
  }
  const enemyHq = state.factions[v.faction === 0 ? 1 : 0];
  const nextPos = moveTowards(v.x, v.y, enemyHq.hqX, enemyHq.hqY, stats.speed);
  v.x = nextPos.x;
  v.y = nextPos.y;
}

// Generic versions of tryAttackEnemyStructure / tryAttackHq that work
// for any combat-capable Unit, not just Raider. Used by Vanguard.
// Original raider-typed helpers are retained for the existing raider
// path so the diff stays minimal; the generics could subsume them in a
// later cleanup.
function tryAttackEnemyStructureForUnit(state: SimState, attacker: Raider | Vanguard): boolean {
  const stats = UNIT_STATS[attacker.kind];
  if (stats.attackDamage === 0) return false;
  const target = findNearestEnemyStructureInRange(state, attacker, rangeSq(stats.attackRange));
  if (target === null) return false;
  if (attacker.attackCooldown > 0) {
    attacker.attackCooldown -= 1;
    return true;
  }
  target.hp = sub(target.hp, stats.attackDamage);
  if (target.hp <= 0) {
    target.alive = false;
    target.hp = 0;
  }
  attacker.attackCooldown = stats.attackCooldownTicks;
  return true;
}

function tryAttackHqForUnit(state: SimState, attacker: Raider | Vanguard): boolean {
  const stats = UNIT_STATS[attacker.kind];
  if (stats.attackDamage === 0) return false;
  const enemyFaction: 0 | 1 = attacker.faction === 0 ? 1 : 0;
  const enemy = state.factions[enemyFaction];
  const inRangeSq = rangeSq(stats.attackRange);
  const d = distSq(attacker.x, attacker.y, enemy.hqX, enemy.hqY);
  if (d > inRangeSq) return false;
  if (attacker.attackCooldown > 0) {
    attacker.attackCooldown -= 1;
    return true;
  }
  // Inline the HQ damage path to avoid retyping the existing raider-
  // specific helper; same shape as damageEnemyHq.
  const target = state.factions[enemyFaction];
  target.hqHp = sub(target.hqHp, stats.attackDamage);
  if (target.hqHp <= 0) target.hqHp = 0;
  attacker.attackCooldown = stats.attackCooldownTicks;
  return true;
}

export function step(state: SimState, rng: Rng, frame: InputFrame): void {
  if (frame.tick !== state.tick) {
    throw new Error(`step: input frame tick ${frame.tick} != state tick ${state.tick}`);
  }

  // Once a winner is set, the sim is frozen. step() still bumps tick
  // and mirrors RNG so replays can run past the end without diverging,
  // but no commands or unit logic apply. This keeps the contract
  // "same input → same output" intact even for past-end frames.
  if (state.winner === null) {
    // 1. Apply commands in order.
    for (let i = 0; i < frame.commands.length; i++) {
      applyCommand(state, frame.commands[i]);
    }

    // 2. Advance units in array-index order. Workers in dump mode
    //    append a segment to their active trail at the post-move
    //    position.
    for (let i = 0; i < state.units.length; i++) {
      advanceUnit(state, state.units[i]);
    }

    // (3.10.9 reverted 2026-05-08): the applyUnitSeparation pass was
    // removed. Three tuning iterations (rigid axis-aligned → hard
    // bounding-box → gentle RNG-perturbed) all stayed inside the
    // limits of "no per-unit velocity stored," and all three read
    // worse in playtest than no collision at all. Reverted to a
    // clean substrate; the proper velocity-based steering rewrite
    // lands in sub-phase 3.10.10. The harvest-reach widening from
    // 3.10.9 is kept (HARVEST_AT_NODE_REACH_SQ in the
    // movingToNode→harvesting transition) — independently useful and
    // doesn't depend on the collision pass.

    // 3. Phase 3.7: trail collision sweep. Runs after unit movement
    //    but BEFORE the trails-age pass, so a freshly-laid segment
    //    (age=0) gets one chance to kill before any aging, and an
    //    old-but-still-live segment kills on the same tick it'd
    //    expire. Order matters for "which segments are lethal this
    //    tick"; pinned here so the hash is reproducible.
    trailKillSweep(state);
    advanceTrails(state);

    // 4. Phase 3.5: passive resource-node regen, after units have
    //    consumed this tick's harvest. Colour nodes heal toward
    //    maxReserve; energy/flux are no-ops (regenPerTick === 0). The
    //    order matters for the hash — if regen ran before workers,
    //    a worker would harvest the post-regen value this tick, which
    //    is fine but a different sequence than what 3.5 commits to.
    for (let i = 0; i < state.nodes.length; i++) {
      advanceNode(state.nodes[i]);
    }

    // 4. Advance structures in array-index order. Building progress
    //    ticks first; once operational, training advances and may
    //    spawn a unit (which appends to state.units, but won't be
    //    advanced this tick — first sim action for a freshly-spawned
    //    unit is next tick. Same shape as TrainUnit's HQ-spawn).
    for (let i = 0; i < state.structures.length; i++) {
      advanceStructure(state, state.structures[i]);
    }

    // 5. Phase 3.6: recompute supply caps from the current set of
    //    operational supply structures. Doing it once at end-of-step
    //    means a Pylon completing build this tick (or dying mid-attack)
    //    is reflected on next tick's command checks; mid-tick the cap
    //    stays whatever it was last recompute, which keeps within-tick
    //    spawn ordering simple.
    recomputeSupplyCaps(state);

    // 6. Phase 3.8: discovery sweep. Marks nodes within vision of any
    //    alive friendly entity as discoveredBy[faction]. Permanent —
    //    once flipped, stays flipped. Runs after units + structures
    //    advance so position-changes from this tick are picked up.
    advanceDiscovery(state);

    // 6. Win-condition checks. Done after units + structures act so a
    //    kill / final HQ-blow this tick is reflected immediately.
    //    Faction-0 wins on tied conditions purely so the rule is
    //    deterministic; ties are unreachable in practice given
    //    asymmetric kill timings.
    state.winner = checkWinner(state);
  }

  // 6. Bump tick + mirror RNG state.
  state.tick += 1;
  state.rngState = rng.snapshot();
}

// Phase 3.7: trail bookkeeping passes.
//
// advanceTrails ages every alive trail's segments by 1, drops segments
// that crossed the effective lifetime, and kills the trail when its
// segment list empties. Effective lifetime depends on the owner
// faction's `trailDurationResearched` flag — looking it up at
// expiry-time (not at segment-spawn-time) means an in-flight trail
// extends the moment the research lands.
function advanceTrails(state: SimState): void {
  for (let i = 0; i < state.trails.length; i++) {
    const t = state.trails[i];
    if (!t.alive) continue;
    const lifetime = state.factions[t.ownerFaction].trailDurationResearched
      ? TRAIL_SEGMENT_LIFETIME * 2
      : TRAIL_SEGMENT_LIFETIME;
    // Age + drop in a single pass. Iterate forward, write-back to a
    // fresh array so segment order stays stable for the hash.
    const next: Trail['segments'] = [];
    for (let j = 0; j < t.segments.length; j++) {
      const seg = t.segments[j];
      const newAge = seg.age + 1;
      if (newAge < lifetime) {
        seg.age = newAge;
        next.push(seg);
      }
    }
    t.segments = next;
    if (t.segments.length === 0) t.alive = false;
  }
}

// trailKillSweep checks every alive non-owner unit against every alive
// trail's segments. Any unit overlapping ANY segment within
// TRAIL_KILL_RANGE_SQ takes lethal damage. Same-faction units are
// safe (the dump worker walks through their own trail unharmed).
// Structures + HQs are immune (only Unit kinds can collide). The
// linear-scan cost is bounded — handful of trails, dozens of segments,
// dozens of units. If unit/trail counts blow up later, a tile bucket
// is the upgrade path.
function trailKillSweep(state: SimState): void {
  for (let ui = 0; ui < state.units.length; ui++) {
    const u = state.units[ui];
    if (!u.alive) continue;
    for (let ti = 0; ti < state.trails.length; ti++) {
      const t = state.trails[ti];
      if (!t.alive) continue;
      if (t.ownerFaction === u.faction) continue;
      let hit = false;
      for (let si = 0; si < t.segments.length; si++) {
        const s = t.segments[si];
        if (distSq(u.x, u.y, s.x, s.y) <= TRAIL_KILL_RANGE_SQ) {
          hit = true;
          break;
        }
      }
      if (hit) {
        // Lethal damage = current hp so applyDamage zeroes + flips
        // alive=false in one call. The kill side-effect (awardKill /
        // points credit) was removed with the 2026-05-07 PvE pivot;
        // who-killed-whom isn't tracked any more.
        applyDamage(state, u, u.hp);
        break; // unit is dead, no need to check other trails
      }
    }
  }
}

// Phase 3.8: per-tick discovery sweep. For each alive friendly entity
// (units + structures + the HQ pseudo-structure on FactionState), check
// every undiscovered node within visionRadius and flip its
// discoveredBy[faction] flag to true. Discovery is permanent — once
// set, never unset (no fog-of-war rediscovery, per the design ask).
//
// Cost is O((units + structures) × undiscovered nodes). Both factors
// are small in this sim. If the unit count blows up later, a tile
// bucket would help; for now the brute-force linear scan is the right
// default and bit-stable.
function advanceDiscovery(state: SimState): void {
  // Helper to mark within a single faction's vision bubble. Only
  // touches nodes that are still undiscovered for that faction (so
  // the loop short-circuits on already-known nodes — cheap path
  // dominates once the map is opened up).
  const markFromPoint = (faction: Faction, x: Fixed, y: Fixed, rSq: Fixed): void => {
    for (let i = 0; i < state.nodes.length; i++) {
      const n = state.nodes[i];
      if (n.discoveredBy[faction]) continue;
      const d = distSq(x, y, n.x, n.y);
      if (d <= rSq) n.discoveredBy[faction] = true;
    }
  };

  // HQs (always alive — destruction ends the match before this pass
  // would skip them). Pre-cached squared radius outside the loop.
  const hqRadSq = rangeSq(HQ_VISION_RADIUS);
  for (const f of [0, 1] as const) {
    const fs = state.factions[f];
    markFromPoint(f, fs.hqX, fs.hqY, hqRadSq);
  }

  // Units project vision per their kind.
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (!u.alive) continue;
    markFromPoint(u.faction, u.x, u.y, rangeSq(UNIT_STATS[u.kind].visionRadius));
  }

  // Structures project vision per their kind. Build phase counts —
  // even a half-built Forge is sitting on the map and reveals its
  // tile, same as a finished one. Simpler model than "vision starts
  // when build completes" and reads the same to the player.
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    markFromPoint(s.faction, s.x, s.y, rangeSq(STRUCTURE_STATS[s.kind].visionRadius));
  }
}

// Phase 3.6: derive each faction's supplyCap from SUPPLY_CAP_INITIAL +
// the bonus per operational (alive + build complete) Pylon. Called
// end-of-step so a Pylon completing build (or dying) this tick is
// visible to next tick's TrainUnit / TrainAtStructure checks.
function recomputeSupplyCaps(state: SimState): void {
  let bonus0 = 0;
  let bonus1 = 0;
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.kind !== 'supply') continue;
    if (s.buildTicksRemaining > 0) continue; // not operational
    if (s.faction === 0) bonus0 += SUPPLY_CAP_BONUS_PER_PYLON;
    else bonus1 += SUPPLY_CAP_BONUS_PER_PYLON;
  }
  state.factions[0].supplyCap = SUPPLY_CAP_INITIAL + bonus0;
  state.factions[1].supplyCap = SUPPLY_CAP_INITIAL + bonus1;
}

// (Phase 3.10.9 reverted 2026-05-08): the pairwise-separation pass
// (`applyUnitSeparation`) and its helpers (`scaledShare`,
// `isCollisionActive`) were removed here. Three tuning iterations of
// axis-aligned, no-velocity collision shipped and were each read in
// playtest as worse than no collision at all. Sub-phase 3.10.10
// rebuilds collision on top of a velocity-based steering layer; the
// scope is captured in `docs/investigation/04-phase-3-faction-and-map-depth.md` § 3.10.10.

function checkWinner(state: SimState): SimState['winner'] {
  // Post-2026-05-07 PvE pivot: HQ destruction is the only path to a
  // winner. The previous points-threshold check (esport scaffolding)
  // has been removed; wave-survival + scenario-objective + boss win
  // conditions land in sub-phase 3.13.
  if (state.factions[1].hqHp <= 0) return 0;
  if (state.factions[0].hqHp <= 0) return 1;
  return null;
}
