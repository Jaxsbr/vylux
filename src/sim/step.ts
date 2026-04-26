// One tick of the simulation. Pure-by-convention — given the same state
// and same inputs, mutates state to the same result every time.
//
// Step ordering (load-bearing for determinism):
//   1. Apply all input commands in given order (deterministic dispatch).
//   2. Advance worker AI by phase, in array-index order.
//   3. Decay node depletion / faction bookkeeping.
//   4. Bump tick counter, mirror RNG state into snapshot.
//
// Mutation is in-place. The renderer never sees mid-step state because the
// renderer pulls from sim only between ticks.

import { Rng } from './rng';
import { CommandKind, type Command, type InputFrame } from './commands';
import { findNode, findWorker, spawnWorker } from './state';
import type { SimState, Worker } from './types';
import { add, distSq, fromFloat, fromInt, rangeSq, sub, type Fixed } from './fixed';

// Tuning — kept small and explicit. Phase 1 hoists these into a
// MatchConfig that the lobby seeds.
export const WORKER_SPEED: Fixed = fromFloat(0.05); // tiles per tick
export const WORKER_REACH_SQ: Fixed = rangeSq(fromFloat(0.06));
export const HARVEST_TICKS = 20; // 1 second at 20 Hz
export const HARVEST_AMOUNT: Fixed = fromInt(5);
export const WORKER_CAPACITY: Fixed = fromInt(5);

export function applyCommand(state: SimState, cmd: Command): void {
  switch (cmd.kind) {
    case CommandKind.Noop:
      return;
    case CommandKind.AssignWorkerToNode: {
      const w = findWorker(state, cmd.workerId);
      const n = findNode(state, cmd.nodeId);
      if (!w || !n) return;
      w.targetNodeId = n.id;
      w.phase = w.carrying > 0 ? 'returning' : 'movingToNode';
      return;
    }
    case CommandKind.SpawnWorker: {
      spawnWorker(state, cmd.faction, fromInt(cmd.x), fromInt(cmd.y));
      return;
    }
  }
}

function moveTowards(curX: Fixed, curY: Fixed, tx: Fixed, ty: Fixed, speed: Fixed): {
  x: Fixed;
  y: Fixed;
} {
  // Chebyshev-style step: move on each axis up to speed, capped at the
  // remaining delta. No sqrt; no normalisation; deterministic by
  // construction.
  const dx = sub(tx, curX);
  const dy = sub(ty, curY);

  const stepX = clampStep(dx, speed);
  const stepY = clampStep(dy, speed);

  return { x: add(curX, stepX), y: add(curY, stepY) };
}

function clampStep(delta: Fixed, speed: Fixed): Fixed {
  if (delta === 0) return 0;
  if (delta > 0) return delta < speed ? delta : speed;
  // delta < 0 — clamp toward zero by -speed.
  const negSpeed = -speed;
  return delta > negSpeed ? delta : negSpeed;
}

function advanceWorker(state: SimState, w: Worker): void {
  if (!w.alive) return;

  switch (w.phase) {
    case 'idle':
      return;

    case 'movingToNode': {
      const node = findNode(state, w.targetNodeId);
      if (!node) {
        // Node was depleted while we were en route. Fall back to idle.
        w.phase = 'idle';
        w.targetNodeId = 0;
        return;
      }
      const nextPos = moveTowards(w.x, w.y, node.x, node.y, WORKER_SPEED);
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
        // Head home.
        w.phase = 'returning';
      }
      return;
    }

    case 'returning': {
      const hq = state.factions[w.faction];
      const nextPos = moveTowards(w.x, w.y, hq.hqX, hq.hqY, WORKER_SPEED);
      w.x = nextPos.x;
      w.y = nextPos.y;
      if (distSq(w.x, w.y, hq.hqX, hq.hqY) <= WORKER_REACH_SQ) {
        // Deposit.
        hq.energy = add(hq.energy, w.carrying);
        w.carrying = 0;
        // If the original node still exists, head back; otherwise idle.
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

export function step(state: SimState, rng: Rng, frame: InputFrame): void {
  if (frame.tick !== state.tick) {
    throw new Error(`step: input frame tick ${frame.tick} != state tick ${state.tick}`);
  }

  // 1. Apply commands in order.
  for (let i = 0; i < frame.commands.length; i++) {
    applyCommand(state, frame.commands[i]);
  }

  // 2. Advance workers in array-index order.
  for (let i = 0; i < state.workers.length; i++) {
    advanceWorker(state, state.workers[i]);
  }

  // 3. (No periodic mechanics yet — node regen, AI, combat come in Phase 1.)

  // 4. Bump tick + mirror RNG state.
  state.tick += 1;
  state.rngState = rng.snapshot();
}
