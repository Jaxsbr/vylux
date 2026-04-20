import { describe, it, expect } from 'vitest';
import {
  createWorkerTask,
  assignWorkerToNode,
  cancelWorkerTask,
  tickWorkerTask,
  findNearestLiveUnoccupied,
  tickNodeRegen,
  HARVEST_DURATION,
  HARVEST_YIELD,
  RESERVE_DEFAULT,
  OFFLOAD_DURATION,
  NODE_REGEN_RATE,
  MIN_REGEN_THRESHOLD,
  type WorkerTask,
  type NodeTarget,
  type HqTarget,
  type WorkerPosition,
} from './worker-task';

function makeWorker(id: string, tileX: number, tileY: number): WorkerPosition {
  return { id, tileX, tileY, targetTileX: tileX, targetTileY: tileY };
}

function makeNode(tileX: number, tileY: number, reserve = RESERVE_DEFAULT, occupiedBy: string | null = null): NodeTarget {
  return { tileX, tileY, reserve, occupiedBy };
}

function makeHq(tileX: number, tileY: number): HqTarget {
  return { tileX, tileY };
}

function makeLiveNode(index: number, tileX: number, tileY: number, reserve = RESERVE_DEFAULT, occupiedBy: string | null = null) {
  return { index, tileX, tileY, reserve, occupiedBy };
}

describe('createWorkerTask', () => {
  it('starts in idle phase with no node assigned', () => {
    const t = createWorkerTask();
    expect(t.phase).toBe('idle');
    expect(t.nodeIndex).toBe(-1);
    expect(t.harvestProgress).toBe(0);
  });
});

describe('assignWorkerToNode', () => {
  it('transitions to walking-to-node', () => {
    const t = createWorkerTask();
    const next = assignWorkerToNode(t, 2);
    expect(next.phase).toBe('walking-to-node');
    expect(next.nodeIndex).toBe(2);
    expect(next.harvestProgress).toBe(0);
  });
});

describe('cancelWorkerTask', () => {
  it('cancels active task and returns idle', () => {
    let t = createWorkerTask();
    t = assignWorkerToNode(t, 0);
    const cancelled = cancelWorkerTask(t);
    expect(cancelled.phase).toBe('idle');
    expect(cancelled.nodeIndex).toBe(-1);
  });

  it('returns same reference when already idle', () => {
    const t = createWorkerTask();
    const same = cancelWorkerTask(t);
    expect(same).toBe(t);
  });
});

describe('tickWorkerTask — idle phase', () => {
  it('returns same task with no moves when idle', () => {
    const t = createWorkerTask();
    const w = makeWorker('w1', 5, 5);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, null, hq, 0.016, []);
    expect(result.task).toBe(t);
    expect(result.moveTo).toBeNull();
    expect(result.offloaded).toBe(false);
  });
});

describe('tickWorkerTask — walking-to-node', () => {
  it('issues moveTo while worker not yet at node', () => {
    let t = createWorkerTask();
    t = assignWorkerToNode(t, 0);
    const w = makeWorker('w1', 5, 5);
    const node = makeNode(10, 10);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, node, hq, 0.016, [makeLiveNode(0, 10, 10)]);
    expect(result.moveTo).toEqual({ tileX: 10, tileY: 10 });
    expect(result.task.phase).toBe('walking-to-node');
  });

  it('transitions to harvesting when worker arrives at node (dist < 0.6)', () => {
    let t = createWorkerTask();
    t = assignWorkerToNode(t, 0);
    // Worker is right on the node tile.
    const w = makeWorker('w1', 10, 10);
    const node = makeNode(10, 10);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, node, hq, 0.016, [makeLiveNode(0, 10, 10)]);
    expect(result.task.phase).toBe('harvesting');
    expect(result.moveTo).toBeNull();
  });

  it('retargets to nearest live node when assigned node is exhausted', () => {
    let t = createWorkerTask();
    t = assignWorkerToNode(t, 0);
    const w = makeWorker('w1', 5, 5);
    const exhaustedNode = makeNode(10, 10, 0); // exhausted
    const liveAlt = makeLiveNode(1, 6, 6);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, exhaustedNode, hq, 0.016, [liveAlt]);
    expect(result.task.phase).toBe('walking-to-node');
    expect(result.task.nodeIndex).toBe(1);
    expect(result.moveTo).toEqual({ tileX: 6, tileY: 6 });
  });

  it('enters hq-idle when assigned node is exhausted and no alternatives', () => {
    let t = createWorkerTask();
    t = assignWorkerToNode(t, 0);
    const w = makeWorker('w1', 5, 5);
    const exhaustedNode = makeNode(10, 10, 0);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, exhaustedNode, hq, 0.016, []);
    expect(result.task.phase).toBe('hq-idle');
  });

  it('retargets when node is occupied by another worker', () => {
    let t = createWorkerTask();
    t = assignWorkerToNode(t, 0);
    const w = makeWorker('w1', 5, 5);
    const occupiedNode = makeNode(10, 10, RESERVE_DEFAULT, 'w2');
    const liveAlt = makeLiveNode(1, 7, 7);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, occupiedNode, hq, 0.016, [liveAlt]);
    expect(result.task.phase).toBe('walking-to-node');
    expect(result.task.nodeIndex).toBe(1);
  });
});

describe('tickWorkerTask — harvesting', () => {
  it('advances harvestProgress over time', () => {
    const t: WorkerTask = {
      phase: 'harvesting',
      nodeIndex: 0,
      harvestProgress: 0,
      offloadTimer: 0,
    };
    const w = makeWorker('w1', 10, 10);
    const node = makeNode(10, 10);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, node, hq, 0.1, [makeLiveNode(0, 10, 10)]);
    expect(result.task.phase).toBe('harvesting');
    expect(result.harvestProgress).toBeCloseTo(0.1 / HARVEST_DURATION);
  });

  it('transitions to walking-to-hq when buffer is full', () => {
    const t: WorkerTask = {
      phase: 'harvesting',
      nodeIndex: 0,
      harvestProgress: 0.99,
      offloadTimer: 0,
    };
    const w = makeWorker('w1', 10, 10);
    const node = makeNode(10, 10);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, node, hq, HARVEST_DURATION, [makeLiveNode(0, 10, 10)]);
    expect(result.task.phase).toBe('walking-to-hq');
    expect(result.moveTo).toEqual({ tileX: 3, tileY: 9 });
  });

  it('retargets when node exhausts mid-harvest', () => {
    const t: WorkerTask = {
      phase: 'harvesting',
      nodeIndex: 0,
      harvestProgress: 0.5,
      offloadTimer: 0,
    };
    const w = makeWorker('w1', 10, 10);
    const exhaustedNode = makeNode(10, 10, 0);
    const altNode = makeLiveNode(1, 6, 6);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, exhaustedNode, hq, 0.016, [altNode]);
    expect(result.task.phase).toBe('walking-to-node');
    expect(result.task.nodeIndex).toBe(1);
  });
});

describe('tickWorkerTask — walking-to-hq', () => {
  it('offloads when close enough to HQ', () => {
    const t: WorkerTask = {
      phase: 'walking-to-hq',
      nodeIndex: 0,
      harvestProgress: 1,
      offloadTimer: 0,
    };
    // Worker is 1 tile from HQ.
    const w = makeWorker('w1', 4, 9);
    const node = makeNode(10, 10);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, node, hq, 0.016, [makeLiveNode(0, 10, 10)]);
    expect(result.offloaded).toBe(true);
    expect(result.task.phase).toBe('offloading');
  });

  it('issues moveTo HQ while still far away', () => {
    const t: WorkerTask = {
      phase: 'walking-to-hq',
      nodeIndex: 0,
      harvestProgress: 1,
      offloadTimer: 0,
    };
    const w = makeWorker('w1', 10, 10);
    const node = makeNode(10, 10);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, node, hq, 0.016, [makeLiveNode(0, 10, 10)]);
    expect(result.offloaded).toBe(false);
    expect(result.moveTo).toEqual({ tileX: 3, tileY: 9 });
  });
});

describe('tickWorkerTask — offloading', () => {
  it('returns to node when offload timer expires', () => {
    const t: WorkerTask = {
      phase: 'offloading',
      nodeIndex: 0,
      harvestProgress: 1,
      offloadTimer: 0.01, // nearly done
    };
    const w = makeWorker('w1', 4, 9);
    const node = makeNode(10, 10);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, node, hq, OFFLOAD_DURATION + 0.1, [makeLiveNode(0, 10, 10)]);
    expect(result.task.phase).toBe('walking-to-node');
    expect(result.moveTo).toEqual({ tileX: 10, tileY: 10 });
  });

  it('retargets after offload if original node is exhausted', () => {
    const t: WorkerTask = {
      phase: 'offloading',
      nodeIndex: 0,
      harvestProgress: 1,
      offloadTimer: 0.01,
    };
    const w = makeWorker('w1', 4, 9);
    const exhaustedNode = makeNode(10, 10, 0); // exhausted
    const altNode = makeLiveNode(1, 7, 7);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, exhaustedNode, hq, OFFLOAD_DURATION + 0.1, [altNode]);
    expect(result.task.phase).toBe('walking-to-node');
    expect(result.task.nodeIndex).toBe(1);
  });

  it('enters hq-idle after offload when all nodes are exhausted', () => {
    const t: WorkerTask = {
      phase: 'offloading',
      nodeIndex: 0,
      harvestProgress: 1,
      offloadTimer: 0.01,
    };
    const w = makeWorker('w1', 4, 9);
    const exhaustedNode = makeNode(10, 10, 0);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, exhaustedNode, hq, OFFLOAD_DURATION + 0.1, []);
    expect(result.task.phase).toBe('hq-idle');
  });
});

describe('findNearestLiveUnoccupied', () => {
  it('returns nearest live unoccupied node', () => {
    const w = { id: 'w1', tileX: 5, tileY: 5 };
    const nodes = [
      makeLiveNode(0, 14, 14, 60, null),
      makeLiveNode(1, 6, 6, 60, null),
    ];
    const result = findNearestLiveUnoccupied(w, nodes, null);
    expect(result).not.toBeNull();
    expect(result!.index).toBe(1); // (6,6) is closer than (14,14)
  });

  it('skips exhausted nodes', () => {
    const w = { id: 'w1', tileX: 5, tileY: 5 };
    const nodes = [
      makeLiveNode(0, 6, 6, 0, null), // exhausted
      makeLiveNode(1, 14, 14, 60, null),
    ];
    const result = findNearestLiveUnoccupied(w, nodes, null);
    expect(result!.index).toBe(1);
  });

  it('skips occupied nodes (different worker)', () => {
    const w = { id: 'w1', tileX: 5, tileY: 5 };
    const nodes = [
      makeLiveNode(0, 6, 6, 60, 'w2'), // occupied by w2
      makeLiveNode(1, 14, 14, 60, null),
    ];
    const result = findNearestLiveUnoccupied(w, nodes, null);
    expect(result!.index).toBe(1);
  });

  it('allows node occupied by same worker', () => {
    const w = { id: 'w1', tileX: 5, tileY: 5 };
    const nodes = [
      makeLiveNode(0, 6, 6, 60, 'w1'), // occupied by w1 (self)
    ];
    const result = findNearestLiveUnoccupied(w, nodes, null);
    expect(result!.index).toBe(0);
  });

  it('excludes node at excludeIndex', () => {
    const w = { id: 'w1', tileX: 5, tileY: 5 };
    const nodes = [
      makeLiveNode(0, 6, 6, 60, null),
      makeLiveNode(1, 14, 14, 60, null),
    ];
    const result = findNearestLiveUnoccupied(w, nodes, 0); // exclude index 0
    expect(result!.index).toBe(1);
  });

  it('returns null when no live unoccupied nodes exist', () => {
    const w = { id: 'w1', tileX: 5, tileY: 5 };
    const result = findNearestLiveUnoccupied(w, [], null);
    expect(result).toBeNull();
  });
});

describe('constants', () => {
  it('HARVEST_DURATION is in [3, 5] seconds', () => {
    expect(HARVEST_DURATION).toBeGreaterThanOrEqual(3);
    expect(HARVEST_DURATION).toBeLessThanOrEqual(5);
  });

  it('HARVEST_YIELD is in [5, 10] range', () => {
    expect(HARVEST_YIELD).toBeGreaterThanOrEqual(5);
    expect(HARVEST_YIELD).toBeLessThanOrEqual(10);
  });

  it('RESERVE_DEFAULT is >= 40', () => {
    expect(RESERVE_DEFAULT).toBeGreaterThanOrEqual(40);
  });

  it('OFFLOAD_DURATION > 0', () => {
    expect(OFFLOAD_DURATION).toBeGreaterThan(0);
  });

  it('NODE_REGEN_RATE is at least 5x slower than worker collection rate', () => {
    const workerCollectionRate = HARVEST_YIELD / HARVEST_DURATION;
    expect(NODE_REGEN_RATE).toBeLessThanOrEqual(workerCollectionRate / 5);
  });

  it('MIN_REGEN_THRESHOLD is ~10% of RESERVE_DEFAULT', () => {
    expect(MIN_REGEN_THRESHOLD).toBeGreaterThan(0);
    expect(MIN_REGEN_THRESHOLD).toBeLessThanOrEqual(RESERVE_DEFAULT * 0.15);
  });
});

describe('tickNodeRegen', () => {
  it('advances reserve over time from 0', () => {
    const newReserve = tickNodeRegen(0, 10);
    expect(newReserve).toBeCloseTo(NODE_REGEN_RATE * 10);
  });

  it('clamps reserve at RESERVE_DEFAULT', () => {
    const newReserve = tickNodeRegen(RESERVE_DEFAULT - 0.1, 100);
    expect(newReserve).toBe(RESERVE_DEFAULT);
  });

  it('does not change reserve already at RESERVE_DEFAULT', () => {
    const newReserve = tickNodeRegen(RESERVE_DEFAULT, 10);
    expect(newReserve).toBe(RESERVE_DEFAULT);
  });

  it('after enough time, reserve crosses MIN_REGEN_THRESHOLD', () => {
    // Time needed: MIN_REGEN_THRESHOLD / NODE_REGEN_RATE
    const timeNeeded = MIN_REGEN_THRESHOLD / NODE_REGEN_RATE;
    const newReserve = tickNodeRegen(0, timeNeeded + 1);
    expect(newReserve).toBeGreaterThanOrEqual(MIN_REGEN_THRESHOLD);
  });
});

describe('tickWorkerTask — hq-idle phase', () => {
  it('walks toward HQ when in hq-idle with no available nodes', () => {
    const t: WorkerTask = {
      phase: 'hq-idle',
      nodeIndex: -1,
      harvestProgress: 0,
      offloadTimer: 0,
    };
    const w = makeWorker('w1', 10, 10); // far from HQ
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, null, hq, 0.016, []);
    expect(result.task.phase).toBe('hq-idle');
    expect(result.moveTo).toEqual({ tileX: 3, tileY: 9 });
    expect(result.offloaded).toBe(false);
  });

  it('stays put when already at HQ with no available nodes', () => {
    const t: WorkerTask = {
      phase: 'hq-idle',
      nodeIndex: -1,
      harvestProgress: 0,
      offloadTimer: 0,
    };
    const w = makeWorker('w1', 3, 9); // at HQ
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, null, hq, 0.016, []);
    expect(result.task.phase).toBe('hq-idle');
    expect(result.moveTo).toBeNull();
  });

  it('immediately re-assigns to nearest live node when one becomes available', () => {
    const t: WorkerTask = {
      phase: 'hq-idle',
      nodeIndex: -1,
      harvestProgress: 0,
      offloadTimer: 0,
    };
    const w = makeWorker('w1', 3, 9); // at HQ
    const hq = makeHq(3, 9);
    const liveNode = makeLiveNode(2, 6, 6); // node just became free
    const result = tickWorkerTask(t, w, null, hq, 0.016, [liveNode]);
    expect(result.task.phase).toBe('walking-to-node');
    expect(result.task.nodeIndex).toBe(2);
    expect(result.moveTo).toEqual({ tileX: 6, tileY: 6 });
  });
});

describe('tickWorkerTask — occupancy released when harvesting phase exits', () => {
  it('offloading phase: node occupiedBy check — worker returns to node when unoccupied', () => {
    const t: WorkerTask = {
      phase: 'offloading',
      nodeIndex: 0,
      harvestProgress: 1,
      offloadTimer: 0.01,
    };
    const w = makeWorker('w1', 3, 9);
    // Node is now unoccupied (occupancy was released when worker left harvesting).
    const node = makeNode(10, 10, RESERVE_DEFAULT, null);
    const hq = makeHq(3, 9);
    const result = tickWorkerTask(t, w, node, hq, OFFLOAD_DURATION + 0.1, [makeLiveNode(0, 10, 10)]);
    expect(result.task.phase).toBe('walking-to-node');
    expect(result.moveTo).toEqual({ tileX: 10, tileY: 10 });
  });

  it('walking-to-hq phase: second worker can claim node immediately', () => {
    // Worker 1 is in walking-to-hq (occupancy should be released).
    // Worker 2 tries to claim the same node.
    const w2 = makeWorker('w2', 8, 8);
    // Node occupiedBy is null (released when w1 left harvesting).
    const node = makeNode(10, 10, RESERVE_DEFAULT, null);
    const nodes = [makeLiveNode(0, 10, 10, RESERVE_DEFAULT, null)];
    const hq = makeHq(3, 9);

    let t2 = createWorkerTask();
    t2 = assignWorkerToNode(t2, 0);
    const result = tickWorkerTask(t2, w2, node, hq, 0.016, nodes);
    // Worker 2 should proceed walking to node (not retarget).
    expect(result.task.phase).toBe('walking-to-node');
    expect(result.task.nodeIndex).toBe(0);
  });
});
