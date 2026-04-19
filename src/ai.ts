// AI opponent — red faction auto-plays on a simple timer build order.
// Pure step table: tickAi is a plain function called each frame from main.ts.
// No state machine, no ML, no reactive targeting.
//
// State-ownership: ai.ts does NOT own scene or placement state. It receives
// all needed arrays by reference from main.ts and mutates only via the same
// interfaces the player uses (trainUnit + moveTo on units).

import type { FactionEnergy } from './economy';
import type { WorkerBundle } from './worker';
import type { DefenderBundle } from './defender';
import type { RaiderBundle } from './raider';
import type { EnergyNodeBundle } from './energy-node';
import type { HQBundle } from './hq';
import { UNIT_COSTS, UNIT_STATS, type UnitKind } from './units-config';
import { trainUnit } from './training';
import { GRID_CONSTANTS } from './grid';
import { advanceRaiders, type AdvanceTarget } from './advance';
import { findNearestLiveUnoccupied } from './worker-task';

export const AI_TRAIN_COOLDOWN = 0.5;
export const AI_WORKER_ASSIGN_INTERVAL = 1.0;
export const AI_RAIDER_MUSTER = 1; // idle-loses-tuning: advance on first raider, not after 3

// Build order: pop front when affordable; loop the tail after exhaustion.
// idle-loses-tuning: raider moved to index 1 so red sends a raider at ~120s base-income.
const BUILD_ORDER_INITIAL: UnitKind[] = [
  'worker', 'raider', 'worker', 'raider', 'raider',
  'defender', 'raider', 'raider',
];
const BUILD_ORDER_LOOP: UnitKind[] = ['defender', 'raider', 'raider'];

export const AI_BUILD_ORDER = [...BUILD_ORDER_INITIAL];

export type AiState = {
  buildQueue: UnitKind[];
  trainCooldown: number;
  workerAssignTimer: number;
  mustering: boolean;
};

export function createAiState(): AiState {
  return {
    buildQueue: [...BUILD_ORDER_INITIAL],
    trainCooldown: 0,
    // Start timer at the full interval so first worker-assign pass fires after 1s,
    // not on the very first frame (which would race with startup assertions).
    workerAssignTimer: AI_WORKER_ASSIGN_INTERVAL,
    mustering: false,
  };
}

export type TickAiParams = {
  state: AiState;
  dt: number;
  energy: FactionEnergy;
  redWorkers: WorkerBundle[];
  redDefenders: DefenderBundle[];
  redRaiders: RaiderBundle[];
  allWorkers: WorkerBundle[];
  allDefenders: DefenderBundle[];
  allRaiders: RaiderBundle[];
  energyNodes: EnergyNodeBundle[];
  redHq: HQBundle;
  blueHq: HQBundle;
  /** Called by AI to apply the trained unit into the scene. */
  onTrained: (kind: UnitKind, tileX: number, tileY: number) => void;
  /** Apply the new energy value after training. */
  onEnergyChanged: (newEnergy: FactionEnergy) => void;
  /** Assign a red worker to the nearest live node via the task system. */
  assignWorkerTask: (w: WorkerBundle, nodeIndex: number) => void;
};

function tileDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

function isIdle(w: WorkerBundle): boolean {
  // Workers with a target different from their current tile are still moving.
  return w.tileX === w.targetTileX && w.tileY === w.targetTileY;
}

export function tickAi(params: TickAiParams): void {
  const {
    state, dt,
    energy, redWorkers, redDefenders, redRaiders,
    allWorkers,
    energyNodes, redHq, blueHq,
    onTrained, onEnergyChanged, assignWorkerTask,
  } = params;

  // --- Cooldown advance ---
  state.trainCooldown = Math.max(0, state.trainCooldown - dt);
  state.workerAssignTimer = Math.max(0, state.workerAssignTimer - dt);

  // --- Build-order training pass ---
  if (state.trainCooldown <= 0 && state.buildQueue.length > 0) {
    const kind = state.buildQueue[0];
    const cost = UNIT_COSTS[kind];
    if (energy.red >= cost) {
      const result = trainUnit(
        energy,
        'red',
        kind,
        redHq.tileX,
        redHq.tileY,
      );

      if (result.ok) {
        onEnergyChanged(result.newEnergy);
        // Units spawn at HQ tile; onTrained handler issues moveTo(spawnPoint) for red.
        onTrained(kind, result.spawnTile.tileX, result.spawnTile.tileY);
        state.buildQueue.shift();
        // Refill queue from loop pattern when exhausted.
        if (state.buildQueue.length === 0) {
          for (const k of BUILD_ORDER_LOOP) {
            state.buildQueue.push(k);
          }
        }
        state.trainCooldown = AI_TRAIN_COOLDOWN;
      }
    }
  }

  // --- Worker assignment pass (every 1.0s) ---
  if (state.workerAssignTimer <= 0) {
    state.workerAssignTimer = AI_WORKER_ASSIGN_INTERVAL;

    // Build live node list for task assignment.
    const liveNodes = energyNodes
      .map((n, i) => ({
        index: i,
        tileX: n.tileX,
        tileY: n.tileY,
        reserve: n.reserve,
        occupiedBy: n.occupiedBy,
      }))
      .filter((n) => n.reserve > 0);

    for (const w of redWorkers) {
      if (!isIdle(w)) continue;
      if (liveNodes.length === 0) break;
      // Find nearest live unoccupied node.
      const best = findNearestLiveUnoccupied(w, liveNodes, null);
      if (best !== null) {
        assignWorkerTask(w, best.index);
      }
    }
  }

  // --- Raider advance pass ---
  // Replace ad-hoc muster/send-at-blue-HQ with the shared advance primitive so
  // red raiders use the same auto-path logic as blue raiders (advance.ts).
  const livingRedRaiders = redRaiders.filter((r) => r.hp > 0);
  if (!state.mustering && livingRedRaiders.length >= AI_RAIDER_MUSTER) {
    state.mustering = true;
  }
  if (state.mustering) {
    // Delegate targeting to the shared advance primitive.
    const blueWorkers = allWorkers.filter((w) => w.faction === 'blue');
    const enemyWorkerTargets: AdvanceTarget[] = blueWorkers.map((w) => ({
      tileX: w.tileX, tileY: w.tileY, hp: w.hp,
    }));
    const hqTarget: AdvanceTarget = {
      tileX: blueHq.tileX, tileY: blueHq.tileY, hp: blueHq.hp,
    };
    advanceRaiders(livingRedRaiders, enemyWorkerTargets, hqTarget, UNIT_STATS.raider.range);
  } else {
    // Pre-muster: park idle raiders that are too close to HQ so spawn tile clears.
    for (const r of livingRedRaiders) {
      if (r.tileX !== r.targetTileX || r.tileY !== r.targetTileY) continue;
      const dist = tileDist(r.tileX, r.tileY, redHq.tileX, redHq.tileY);
      if (dist <= 1) {
        // Park 2 tiles left and 1 below HQ — different spot from defenders to avoid pile-up.
        const parkX = Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, redHq.tileX - 2));
        const parkY = Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, redHq.tileY - 1));
        r.moveTo(parkX, parkY);
      }
    }
  }

  // --- Defender parking pass ---
  // Defenders spawn at HQ direct neighbors (dist ≤ 1). Move them 2 tiles away
  // so they free the spawn tile for the next training. Target: tiles at dist
  // exactly 2 from HQ (not direct neighbors that would re-block spawn).
  for (const d of redDefenders) {
    if (d.hp <= 0) continue;
    const dist = tileDist(d.tileX, d.tileY, redHq.tileX, redHq.tileY);
    if (dist <= 1 && d.tileX === d.targetTileX && d.tileY === d.targetTileY) {
      // Park 2 tiles left of HQ — always in-bounds given PROXIMITY_RADIUS=3 clearance.
      const parkX = Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, redHq.tileX - 2));
      const parkY = Math.max(0, Math.min(GRID_CONSTANTS.gridSize - 1, redHq.tileY));
      d.moveTo(parkX, parkY);
    }
  }
}
