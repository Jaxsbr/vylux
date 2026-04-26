// One tick of the simulation. Pure-by-convention — given the same state
// and same inputs, mutates state to the same result every time.
//
// Step ordering (load-bearing for determinism):
//   1. Apply all input commands in given order (deterministic dispatch).
//   2. Advance units by kind + state, in array-index order.
//      - Workers: harvest/return loop.
//      - Defenders: attack-in-range only.
//      - Raiders: move toward enemy HQ + attack-in-range.
//   3. (Future) periodic mechanics: node regen, points accrual, AI tick.
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
import { findNode, findUnit, spawnUnit } from './state';
import type { Defender, Raider, SimState, Unit, Worker } from './types';
import {
  add,
  distSq,
  fromFloat,
  fromInt,
  rangeSq,
  sub,
  type Fixed,
} from './fixed';
import { UNIT_STATS } from './units-config';

// Worker-loop tuning still lives here for now. Per-kind stats moved to
// units-config.ts; these are loop-shape constants that don't fit there.
export const WORKER_REACH_SQ: Fixed = rangeSq(fromFloat(0.06));
export const HARVEST_TICKS = 20; // 1 second at 20 Hz
export const HARVEST_AMOUNT: Fixed = fromInt(5);
export const WORKER_CAPACITY: Fixed = fromInt(5);

export function applyCommand(state: SimState, cmd: Command): void {
  switch (cmd.kind) {
    case CommandKind.Noop:
      return;
    case CommandKind.AssignWorkerToNode: {
      const u = findUnit(state, cmd.workerId);
      if (!u || u.kind !== 'worker') return;
      const n = findNode(state, cmd.nodeId);
      if (!n) return;
      u.targetNodeId = n.id;
      u.phase = u.carrying > 0 ? 'returning' : 'movingToNode';
      return;
    }
    case CommandKind.SpawnUnit: {
      spawnUnit(state, cmd.unitKind, cmd.faction, fromInt(cmd.x), fromInt(cmd.y));
      return;
    }
    case CommandKind.TrainUnit: {
      const stats = UNIT_STATS[cmd.unitKind];
      const fs = state.factions[cmd.faction];
      if (fs.energy < stats.trainCost) {
        // Silent reject. UI surfaces "not enough energy"; sim treats it
        // as a no-op so a misfired AI/player command can't crash a match.
        return;
      }
      fs.energy = sub(fs.energy, stats.trainCost);
      // Spawn at HQ. Multi-unit overlap is allowed by the sim — the
      // renderer disambiguates with small visual offsets, and Phase 1.4+
      // can introduce real spawn-tile selection if the design needs it.
      spawnUnit(state, cmd.unitKind, cmd.faction, fs.hqX, fs.hqY);
      return;
    }
  }
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

function applyDamage(target: Unit, damage: Fixed): void {
  target.hp = sub(target.hp, damage);
  if (target.hp <= 0) {
    target.alive = false;
    target.hp = 0;
    // Workers carrying energy lose it on death — no salvage. Phase 1
    // economic balance question; leave as a simple rule for now.
    if (target.kind === 'worker') {
      target.carrying = 0;
      target.phase = 'idle';
      target.targetNodeId = 0;
    }
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

function tryAttack(state: SimState, attacker: Defender | Raider): AttackOutcome {
  const stats = UNIT_STATS[attacker.kind];
  if (stats.attackDamage === 0) return { engaged: false, fired: false };

  const target = findNearestEnemyInRange(state, attacker, rangeSq(stats.attackRange));

  if (attacker.attackCooldown > 0) {
    attacker.attackCooldown -= 1;
    return { engaged: target !== null, fired: false };
  }
  if (!target) return { engaged: false, fired: false };

  applyDamage(target, stats.attackDamage);
  attacker.attackCooldown = stats.attackCooldownTicks;
  return { engaged: true, fired: true };
}

function advanceWorker(state: SimState, w: Worker): void {
  switch (w.phase) {
    case 'idle':
      return;

    case 'movingToNode': {
      const node = findNode(state, w.targetNodeId);
      if (!node) {
        w.phase = 'idle';
        w.targetNodeId = 0;
        return;
      }
      const stats = UNIT_STATS.worker;
      const nextPos = moveTowards(w.x, w.y, node.x, node.y, stats.speed);
      w.x = nextPos.x;
      w.y = nextPos.y;
      if (distSq(w.x, w.y, node.x, node.y) <= WORKER_REACH_SQ) {
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
      w.harvestTicksRemaining -= 1;
      if (w.harvestTicksRemaining <= 0) {
        const taken = node.remaining < HARVEST_AMOUNT ? node.remaining : HARVEST_AMOUNT;
        const carry = w.carrying + taken < WORKER_CAPACITY ? w.carrying + taken : WORKER_CAPACITY;
        const actuallyTaken = carry - w.carrying;
        node.remaining = sub(node.remaining, actuallyTaken);
        w.carrying = carry;
        if (node.remaining <= 0) {
          node.alive = false;
        }
        w.phase = 'returning';
      }
      return;
    }

    case 'returning': {
      const hq = state.factions[w.faction];
      const stats = UNIT_STATS.worker;
      const nextPos = moveTowards(w.x, w.y, hq.hqX, hq.hqY, stats.speed);
      w.x = nextPos.x;
      w.y = nextPos.y;
      if (distSq(w.x, w.y, hq.hqX, hq.hqY) <= WORKER_REACH_SQ) {
        hq.energy = add(hq.energy, w.carrying);
        w.carrying = 0;
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
  // Engage first. If a target is in range — even if cooldown blocks
  // firing this tick — the raider holds position. Otherwise marches
  // toward the enemy HQ.
  const outcome = tryAttack(state, r);
  if (outcome.engaged) return;

  const stats = UNIT_STATS.raider;
  const enemyHq = state.factions[r.faction === 0 ? 1 : 0];
  const nextPos = moveTowards(r.x, r.y, enemyHq.hqX, enemyHq.hqY, stats.speed);
  r.x = nextPos.x;
  r.y = nextPos.y;
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
  }
}

export function step(state: SimState, rng: Rng, frame: InputFrame): void {
  if (frame.tick !== state.tick) {
    throw new Error(`step: input frame tick ${frame.tick} != state tick ${state.tick}`);
  }

  // 1. Apply commands in order.
  for (let i = 0; i < frame.commands.length; i++) {
    applyCommand(state, frame.commands[i]);
  }

  // 2. Advance units in array-index order.
  for (let i = 0; i < state.units.length; i++) {
    advanceUnit(state, state.units[i]);
  }

  // 3. (No periodic mechanics yet — node regen, points, AI come in
  //     Phase 1.1 / 1.2.)

  // 4. Bump tick + mirror RNG state.
  state.tick += 1;
  state.rngState = rng.snapshot();
}
