// worker-task.ts — Pure state machine for the worker task loop.
//
// States: idle | walking-to-node | harvesting | walking-to-hq | offloading
//
// Transitions are pure functions: (state, event) → state.
// No imports from scene.ts, input.ts, or placement.ts.
// Scene (main.ts) drives the task each frame by calling tickWorkerTask().

export const HARVEST_DURATION = 4.0; // seconds to fill buffer
export const HARVEST_YIELD = 8; // energy added on offload
export const RESERVE_DEFAULT = 60; // starting reserve per node
export const OFFLOAD_DURATION = 0.5; // seconds to animate offload

// Regeneration — exhausted nodes slowly refill.
// NODE_REGEN_RATE must be <= HARVEST_YIELD / HARVEST_DURATION / 5 to stay 5x slower than workers.
// Worker collection rate: HARVEST_YIELD / HARVEST_DURATION = 8 / 4 = 2 reserve/sec.
// Regen rate: 0.4 reserve/sec → exactly 5x slower (ratio = 5.0).
export const NODE_REGEN_RATE = 0.4; // reserve per second
// Node becomes eligible once reserve crosses this threshold (10% of RESERVE_DEFAULT).
export const MIN_REGEN_THRESHOLD = 6; // reserve units (= 10% of 60)

/**
 * Advance a node's reserve by regeneration.
 * Returns the new reserve value (clamped to RESERVE_DEFAULT).
 * The node is considered re-eligible (live) once newReserve >= MIN_REGEN_THRESHOLD.
 * Pure — does not mutate any argument.
 */
export function tickNodeRegen(reserve: number, dt: number): number {
  if (reserve >= RESERVE_DEFAULT) return reserve;
  return Math.min(RESERVE_DEFAULT, reserve + NODE_REGEN_RATE * dt);
}

export type WorkerTaskPhase =
  | 'idle'
  | 'walking-to-node'
  | 'harvesting'
  | 'walking-to-hq'
  | 'offloading';

export type WorkerTask = {
  phase: WorkerTaskPhase;
  /** Node index in energyNodes array, or -1 when not assigned. */
  nodeIndex: number;
  /** Fill progress 0–1 during harvesting phase. */
  harvestProgress: number;
  /** Countdown for the offload animation. */
  offloadTimer: number;
};

export function createWorkerTask(): WorkerTask {
  return {
    phase: 'idle',
    nodeIndex: -1,
    harvestProgress: 0,
    offloadTimer: 0,
  };
}

/**
 * Assign a worker to a node. Returns a new task in walking-to-node phase,
 * or the same task if assignment is invalid.
 */
export function assignWorkerToNode(
  _task: WorkerTask,
  nodeIndex: number,
): WorkerTask {
  return {
    phase: 'walking-to-node',
    nodeIndex,
    harvestProgress: 0,
    offloadTimer: 0,
  };
}

/**
 * Cancel the task (e.g. player issues a manual move).
 * Returns task in idle phase, clearing the node assignment.
 */
export function cancelWorkerTask(task: WorkerTask): WorkerTask {
  if (task.phase === 'idle' && task.nodeIndex === -1) return task;
  return { phase: 'idle', nodeIndex: -1, harvestProgress: 0, offloadTimer: 0 };
}

export type NodeTarget = {
  tileX: number;
  tileY: number;
  reserve: number;
  occupiedBy: string | null;
};

export type HqTarget = {
  tileX: number;
  tileY: number;
};

export type WorkerPosition = {
  tileX: number;
  tileY: number;
  targetTileX: number;
  targetTileY: number;
  id: string;
};

/**
 * Result of ticking a worker task for one frame.
 */
export type TaskTickResult = {
  task: WorkerTask;
  /** If true, the worker should start moving to nodeTile. */
  moveTo: { tileX: number; tileY: number } | null;
  /** If true, the worker just completed an offload — caller adds HARVEST_YIELD energy. */
  offloaded: boolean;
  /** New harvest progress (0–1) for the fill animation. */
  harvestProgress: number;
};

function tileDist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Advance a worker task for one frame.
 * Pure: does not mutate any argument; returns a new TaskTickResult.
 *
 * @param task       Current task state.
 * @param worker     Current tile + target tile + id.
 * @param node       Node the worker is assigned to (or null if nodeIndex === -1).
 * @param hq         The worker's faction HQ tile.
 * @param dt         Frame delta in seconds.
 * @param liveNodes  Array of node targets for retargeting (all live nodes).
 */
export function tickWorkerTask(
  task: WorkerTask,
  worker: WorkerPosition,
  node: NodeTarget | null,
  hq: HqTarget,
  dt: number,
  liveNodes: Array<{ index: number } & NodeTarget>,
): TaskTickResult {
  const noOp: TaskTickResult = {
    task,
    moveTo: null,
    offloaded: false,
    harvestProgress: task.harvestProgress,
  };

  switch (task.phase) {
    case 'idle':
      return noOp;

    case 'walking-to-node': {
      if (node === null) {
        // Node gone — retarget or idle.
        const retarget = findNearestLiveUnoccupied(worker, liveNodes, null);
        if (retarget !== null) {
          const newTask = assignWorkerToNode(task, retarget.index);
          return { task: newTask, moveTo: { tileX: retarget.tileX, tileY: retarget.tileY }, offloaded: false, harvestProgress: 0 };
        }
        return { task: { ...task, phase: 'idle', nodeIndex: -1 }, moveTo: null, offloaded: false, harvestProgress: 0 };
      }

      if (node.reserve < MIN_REGEN_THRESHOLD) {
        // Node exhausted/ineligible before arrival — retarget.
        const retarget = findNearestLiveUnoccupied(worker, liveNodes, null);
        if (retarget !== null) {
          const newTask = assignWorkerToNode(task, retarget.index);
          return { task: newTask, moveTo: { tileX: retarget.tileX, tileY: retarget.tileY }, offloaded: false, harvestProgress: 0 };
        }
        return { task: { ...task, phase: 'idle', nodeIndex: -1 }, moveTo: null, offloaded: false, harvestProgress: 0 };
      }

      // Check if occupied by another worker.
      if (node.occupiedBy !== null && node.occupiedBy !== worker.id) {
        const retarget = findNearestLiveUnoccupied(worker, liveNodes, null);
        if (retarget !== null) {
          const newTask = assignWorkerToNode(task, retarget.index);
          return { task: newTask, moveTo: { tileX: retarget.tileX, tileY: retarget.tileY }, offloaded: false, harvestProgress: 0 };
        }
        return { task: { ...task, phase: 'idle', nodeIndex: -1 }, moveTo: null, offloaded: false, harvestProgress: 0 };
      }

      const distToNode = tileDist(worker.tileX, worker.tileY, node.tileX, node.tileY);
      if (distToNode < 0.6) {
        // Arrived at node — begin harvesting.
        const newTask: WorkerTask = { ...task, phase: 'harvesting', harvestProgress: 0 };
        return { task: newTask, moveTo: null, offloaded: false, harvestProgress: 0 };
      }

      // Still walking — keep issuing moveTo so it stays on course.
      return { task, moveTo: { tileX: node.tileX, tileY: node.tileY }, offloaded: false, harvestProgress: task.harvestProgress };
    }

    case 'harvesting': {
      if (node === null || node.reserve < MIN_REGEN_THRESHOLD) {
        // Node exhausted/ineligible mid-harvest — retarget.
        const retarget = findNearestLiveUnoccupied(worker, liveNodes, null);
        if (retarget !== null) {
          const newTask = assignWorkerToNode(task, retarget.index);
          return { task: newTask, moveTo: { tileX: retarget.tileX, tileY: retarget.tileY }, offloaded: false, harvestProgress: 0 };
        }
        return { task: { ...task, phase: 'idle', nodeIndex: -1 }, moveTo: null, offloaded: false, harvestProgress: 0 };
      }

      const newProgress = Math.min(1, task.harvestProgress + dt / HARVEST_DURATION);
      if (newProgress >= 1) {
        // Buffer full — walk back to HQ.
        const newTask: WorkerTask = { ...task, phase: 'walking-to-hq', harvestProgress: 1 };
        return { task: newTask, moveTo: { tileX: hq.tileX, tileY: hq.tileY }, offloaded: false, harvestProgress: 1 };
      }
      const newTask: WorkerTask = { ...task, harvestProgress: newProgress };
      return { task: newTask, moveTo: null, offloaded: false, harvestProgress: newProgress };
    }

    case 'walking-to-hq': {
      const distToHq = tileDist(worker.tileX, worker.tileY, hq.tileX, hq.tileY);
      if (distToHq < 1.5) {
        // Close enough to HQ — offload.
        const newTask: WorkerTask = {
          ...task,
          phase: 'offloading',
          harvestProgress: 1,
          offloadTimer: OFFLOAD_DURATION,
        };
        return { task: newTask, moveTo: null, offloaded: true, harvestProgress: 1 };
      }
      return { task, moveTo: { tileX: hq.tileX, tileY: hq.tileY }, offloaded: false, harvestProgress: task.harvestProgress };
    }

    case 'offloading': {
      const remaining = task.offloadTimer - dt;
      if (remaining <= 0) {
        // Done offloading — go back to node (if still live/eligible and unoccupied).
        if (node !== null && node.reserve >= MIN_REGEN_THRESHOLD && (node.occupiedBy === null || node.occupiedBy === worker.id)) {
          const newTask: WorkerTask = { ...task, phase: 'walking-to-node', harvestProgress: 0, offloadTimer: 0 };
          return { task: newTask, moveTo: { tileX: node.tileX, tileY: node.tileY }, offloaded: false, harvestProgress: 0 };
        }
        // Node gone — retarget.
        const retarget = findNearestLiveUnoccupied(worker, liveNodes, null);
        if (retarget !== null) {
          const newTask = assignWorkerToNode(task, retarget.index);
          return { task: newTask, moveTo: { tileX: retarget.tileX, tileY: retarget.tileY }, offloaded: false, harvestProgress: 0 };
        }
        return { task: { ...task, phase: 'idle', nodeIndex: -1, harvestProgress: 0, offloadTimer: 0 }, moveTo: null, offloaded: false, harvestProgress: 0 };
      }
      const newTask: WorkerTask = { ...task, offloadTimer: remaining };
      return { task: newTask, moveTo: null, offloaded: false, harvestProgress: task.harvestProgress };
    }

    default: {
      const _exhaustive: never = task.phase;
      return { ...noOp, task: { ...task } };
      void _exhaustive;
    }
  }
}

/**
 * Find the nearest live (reserve > 0) unoccupied node to a worker.
 * Excludes the node at excludeIndex (e.g. current node that's exhausted).
 * Returns null if no live unoccupied node exists.
 */
export function findNearestLiveUnoccupied(
  worker: { tileX: number; tileY: number; id: string },
  nodes: Array<{ index: number } & NodeTarget>,
  excludeIndex: number | null,
): ({ index: number } & NodeTarget) | null {
  let best: ({ index: number } & NodeTarget) | null = null;
  let bestDist = Infinity;

  for (const node of nodes) {
    if (excludeIndex !== null && node.index === excludeIndex) continue;
    if (node.reserve < MIN_REGEN_THRESHOLD) continue; // node is exhausted/below re-eligible threshold
    if (node.occupiedBy !== null && node.occupiedBy !== worker.id) continue;
    const d = tileDist(worker.tileX, worker.tileY, node.tileX, node.tileY);
    if (d < bestDist) {
      bestDist = d;
      best = node;
    }
  }

  return best;
}
