import { describe, it, expect, vi } from 'vitest';
import {
  tickAi,
  createAiState,
  AI_BUILD_ORDER,
  AI_TRAIN_COOLDOWN,
  AI_WORKER_ASSIGN_INTERVAL,
  AI_RAIDER_MUSTER,
  type TickAiParams,
} from './ai';
import type { WorkerBundle } from './worker';
import type { RaiderBundle } from './raider';
import type { EnergyNodeBundle } from './energy-node';
import type { HQBundle } from './hq';

// Minimal stubs — no Three.js required.

function makeWorker(tileX: number, tileY: number, faction: 'red' | 'blue' = 'red'): WorkerBundle {
  const w = {
    faction,
    tileX,
    tileY,
    targetTileX: tileX,
    targetTileY: tileY,
    hp: 20,
    maxHp: 20,
    moveTo: vi.fn((tx: number, ty: number) => {
      w.targetTileX = tx;
      w.targetTileY = ty;
    }),
  } as unknown as WorkerBundle;
  return w;
}

function makeRaider(tileX: number, tileY: number, hp = 40): RaiderBundle {
  const r = {
    faction: 'red' as const,
    tileX,
    tileY,
    targetTileX: tileX,
    targetTileY: tileY,
    hp,
    maxHp: 40,
    moveTo: vi.fn((tx: number, ty: number) => {
      r.targetTileX = tx;
      r.targetTileY = ty;
    }),
  } as unknown as RaiderBundle;
  return r;
}

function makeNode(tileX: number, tileY: number): EnergyNodeBundle {
  return { tileX, tileY } as EnergyNodeBundle;
}

function makeHq(tileX: number, tileY: number): HQBundle {
  return { tileX, tileY, faction: 'red' as const, hp: 500 } as unknown as HQBundle;
}

function makeParams(overrides: Partial<TickAiParams> = {}): TickAiParams {
  const redHq = makeHq(19, 19);
  const blueHq = makeHq(0, 0);
  return {
    state: createAiState(),
    dt: 0.016,
    energy: { blue: 0, red: 0 },
    redWorkers: [],
    redDefenders: [],
    redRaiders: [],
    allWorkers: [],
    allDefenders: [],
    allRaiders: [],
    energyNodes: [],
    redHq,
    blueHq,
    onTrained: vi.fn(),
    onEnergyChanged: vi.fn(),
    ...overrides,
  };
}

describe('AI_BUILD_ORDER', () => {
  // idle-loses-tuning: raider moved to index 1 so red gets aggression early.
  it('starts with worker, raider, worker, raider, raider sequence', () => {
    expect(AI_BUILD_ORDER[0]).toBe('worker');
    expect(AI_BUILD_ORDER[1]).toBe('raider');
    expect(AI_BUILD_ORDER[2]).toBe('worker');
    expect(AI_BUILD_ORDER[3]).toBe('raider');
    expect(AI_BUILD_ORDER[4]).toBe('raider');
  });
});

describe('tickAi — training', () => {
  it('with 20 energy pops worker and calls onTrained', () => {
    const onTrained = vi.fn();
    const onEnergyChanged = vi.fn();
    const state = createAiState();
    tickAi(makeParams({
      state,
      energy: { blue: 0, red: 20 },
      onTrained,
      onEnergyChanged,
    }));
    expect(onTrained).toHaveBeenCalledOnce();
    expect(onTrained.mock.calls[0][0]).toBe('worker');
    expect(onEnergyChanged).toHaveBeenCalledOnce();
    // Queue popped front (worker). Next item is raider (idle-loses-tuning build order).
    expect(state.buildQueue[0]).toBe('raider');
    expect(state.trainCooldown).toBeCloseTo(AI_TRAIN_COOLDOWN);
  });

  it('with 0 energy does not train and queue is unchanged', () => {
    const onTrained = vi.fn();
    const state = createAiState();
    const queueBefore = [...state.buildQueue];
    tickAi(makeParams({ state, energy: { blue: 0, red: 0 }, onTrained }));
    expect(onTrained).not.toHaveBeenCalled();
    expect(state.buildQueue).toEqual(queueBefore);
  });

  it('cooldown prevents back-to-back training in same frame', () => {
    const onTrained = vi.fn();
    const state = createAiState();
    // First tick trains.
    tickAi(makeParams({ state, energy: { blue: 0, red: 20 }, onTrained }));
    expect(onTrained).toHaveBeenCalledTimes(1);
    // Second tick with same dt — cooldown is 0.5s, dt is 0.016, still blocked.
    tickAi(makeParams({ state, energy: { blue: 0, red: 20 }, onTrained }));
    expect(onTrained).toHaveBeenCalledTimes(1);
  });

  it('queue loops to [defender, raider, raider] after initial order exhausted', () => {
    const state = createAiState();
    // Drain queue entirely.
    state.buildQueue = [];
    // Simulate what tickAi does when queue empties after a train.
    // We do this by setting trainCooldown to 0 and triggering with a just-emptied queue.
    // To test the loop behaviour, let the AI refill.
    const onTrained = vi.fn();
    // Force state: queue has 1 item, energy is enough.
    state.buildQueue = ['raider'];
    state.trainCooldown = 0;
    tickAi(makeParams({ state, energy: { blue: 0, red: 100 }, onTrained }));
    // After training raider, queue was empty → refilled with loop.
    expect(state.buildQueue).toEqual(['defender', 'raider', 'raider']);
  });
});

describe('tickAi — worker assignment', () => {
  it('assigns idle red worker to nearest unheld node', () => {
    const w = makeWorker(10, 10);
    const nodeNear = makeNode(11, 11);
    const nodeFar = makeNode(0, 0);
    const state = createAiState();
    // Force the worker assign timer to fire immediately.
    state.workerAssignTimer = 0;
    tickAi(makeParams({
      state,
      energy: { blue: 0, red: 0 },
      redWorkers: [w],
      allWorkers: [w],
      energyNodes: [nodeFar, nodeNear],
    }));
    // Worker should have been sent to nodeNear (index 1, dist ~1.41) not nodeFar (dist ~14.1)
    expect((w.moveTo as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(11, 11);
  });

  it('does not assign busy worker', () => {
    const w = makeWorker(10, 10);
    // Mark it as moving.
    w.targetTileX = 5;
    w.targetTileY = 5;
    const node = makeNode(11, 11);
    const state = createAiState();
    state.workerAssignTimer = 0;
    tickAi(makeParams({
      state,
      energy: { blue: 0, red: 0 },
      redWorkers: [w],
      allWorkers: [w],
      energyNodes: [node],
    }));
    expect((w.moveTo as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('does not reassign before interval elapses', () => {
    const w = makeWorker(10, 10);
    const node = makeNode(11, 11);
    const state = createAiState();
    // Timer still counting down (> 0).
    state.workerAssignTimer = AI_WORKER_ASSIGN_INTERVAL;
    tickAi(makeParams({
      state,
      dt: 0.016,
      energy: { blue: 0, red: 0 },
      redWorkers: [w],
      allWorkers: [w],
      energyNodes: [node],
    }));
    expect((w.moveTo as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe('tickAi — raider muster', () => {
  // idle-loses-tuning: AI_RAIDER_MUSTER lowered to 1, so muster fires immediately.
  it('muster fires at 1 raider (AI_RAIDER_MUSTER=1)', () => {
    const raiders = [makeRaider(18, 18)];
    const state = createAiState();
    const blueHq = makeHq(0, 0);
    tickAi(makeParams({ state, energy: { blue: 0, red: 0 }, redRaiders: raiders, allRaiders: raiders, blueHq }));
    expect(state.mustering).toBe(true);
  });

  it('muster fires at 3 raiders (also valid since AI_RAIDER_MUSTER=1)', () => {
    const raiders = [makeRaider(18, 18), makeRaider(17, 18), makeRaider(18, 17)];
    const state = createAiState();
    const blueHq = makeHq(0, 0);
    tickAi(makeParams({ state, energy: { blue: 0, red: 0 }, redRaiders: raiders, allRaiders: raiders, blueHq }));
    expect(state.mustering).toBe(true);
  });

  it('after muster all living raiders target blue HQ', () => {
    const raiders = [makeRaider(18, 18), makeRaider(17, 18), makeRaider(18, 17)];
    const state = createAiState();
    const blueHq = makeHq(0, 0);
    tickAi(makeParams({ state, energy: { blue: 0, red: 0 }, redRaiders: raiders, allRaiders: raiders, blueHq }));
    for (const r of raiders) {
      expect(r.targetTileX).toBe(0);
      expect(r.targetTileY).toBe(0);
    }
  });

  it('dead raiders are excluded from muster count — 1 alive still musters (AI_RAIDER_MUSTER=1)', () => {
    const raiders = [makeRaider(18, 18, 0), makeRaider(17, 18, 0), makeRaider(18, 17)];
    const state = createAiState();
    const blueHq = makeHq(0, 0);
    tickAi(makeParams({ state, energy: { blue: 0, red: 0 }, redRaiders: raiders, allRaiders: raiders, blueHq }));
    // 1 alive raider → muster fires since AI_RAIDER_MUSTER=1.
    expect(state.mustering).toBe(true);
  });
});

describe('tickAi constants', () => {
  it('AI_TRAIN_COOLDOWN is 0.5', () => expect(AI_TRAIN_COOLDOWN).toBe(0.5));
  it('AI_WORKER_ASSIGN_INTERVAL is 1.0', () => expect(AI_WORKER_ASSIGN_INTERVAL).toBe(1.0));
  it('AI_RAIDER_MUSTER is 1', () => expect(AI_RAIDER_MUSTER).toBe(1));
});
