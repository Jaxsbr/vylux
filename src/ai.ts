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
import { trainUnit, buildOccupiedSet } from './training';
import { advanceRaiders, type AdvanceTarget, type AdvanceDefender } from './advance';
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
  /**
   * Return the current task phase for a worker, or 'idle' if not yet tracked.
   * Used to avoid re-assigning workers that are already running a task loop.
   */
  getWorkerTaskPhase: (w: WorkerBundle) => import('./worker-task').WorkerTaskPhase;
};

function isIdle(w: WorkerBundle): boolean {
  // Workers with a target different from their current tile are still moving.
  return w.tileX === w.targetTileX && w.tileY === w.targetTileY;
}

export function tickAi(params: TickAiParams): void {
  const {
    state, dt,
    energy, redWorkers, redDefenders, redRaiders,
    allWorkers, allDefenders, allRaiders,
    energyNodes, redHq, blueHq,
    onTrained, onEnergyChanged, assignWorkerTask, getWorkerTaskPhase,
  } = params;

  // --- Cooldown advance ---
  state.trainCooldown = Math.max(0, state.trainCooldown - dt);
  state.workerAssignTimer = Math.max(0, state.workerAssignTimer - dt);

  // --- Build-order training pass ---
  if (state.trainCooldown <= 0 && state.buildQueue.length > 0) {
    const kind = state.buildQueue[0];
    const cost = UNIT_COSTS[kind];
    if (energy.red >= cost) {
      const allUnits = [...allWorkers, ...allDefenders, ...allRaiders];
      const occupied = buildOccupiedSet(allUnits, [redHq, blueHq]);
      const isOccupied = (tx: number, ty: number): boolean => occupied.has(`${tx},${ty}`);

      const result = trainUnit(
        energy,
        'red',
        kind,
        redHq.tileX,
        redHq.tileY,
        isOccupied,
      );

      if (result.ok) {
        onEnergyChanged(result.newEnergy);
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
      const phase = getWorkerTaskPhase(w);
      // Assign idle workers or hq-idle workers waiting for a node.
      if (phase !== 'idle' && phase !== 'hq-idle') continue;
      // Physical idle check only for purely idle workers (hq-idle already walks to HQ).
      if (phase === 'idle' && !isIdle(w)) continue;
      if (liveNodes.length === 0) break;
      // Find nearest live unoccupied node.
      const best = findNearestLiveUnoccupied(w, liveNodes, null);
      if (best !== null) {
        assignWorkerTask(w, best.index);
      }
    }
  }

  // --- Raider advance pass ---
  // Red raiders use the shared advance primitive (same logic as blue raiders).
  const livingRedRaiders = redRaiders.filter((r) => r.hp > 0);
  if (!state.mustering && livingRedRaiders.length >= AI_RAIDER_MUSTER) {
    state.mustering = true;
  }
  if (state.mustering) {
    const blueWorkers = allWorkers.filter((w) => w.faction === 'blue');
    const blueDefenders = allDefenders.filter((d) => d.faction === 'blue');
    const enemyWorkerTargets: AdvanceTarget[] = blueWorkers.map((w) => ({
      tileX: w.tileX, tileY: w.tileY, hp: w.hp,
    }));
    const enemyDefenderTargets: AdvanceDefender[] = blueDefenders.map((d) => ({
      tileX: d.tileX, tileY: d.tileY, hp: d.hp, unitId: d.unitId,
    }));
    const hqTarget: AdvanceTarget = {
      tileX: blueHq.tileX, tileY: blueHq.tileY, hp: blueHq.hp,
    };
    advanceRaiders(livingRedRaiders, enemyWorkerTargets, enemyDefenderTargets, hqTarget, UNIT_STATS.raider.range);
  }

  // Suppress unused warning — redDefenders passed in for future use (e.g. AI defender retreat).
  void redDefenders;
}
