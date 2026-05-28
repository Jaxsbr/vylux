// Phase C.6.6 — grid A* pathfinding (pure, waypoint-following).
//
// Pure-function checks on findPath, plus end-to-end sim regressions for the
// bugs that motivated A*: two work pods side by side, and a node sitting right
// behind those pods (the proximity-exemption trap). With pure A* the worker
// must route around the pods — there's no steering layer to oscillate.

import { describe, expect, it } from 'vitest';
import { Sim } from './sim';
import { CommandKind } from './commands';
import { fromFloat, fromInt, rangeSq, toFloat } from './fixed';
import { findPath, tileAxis, packTile, NO_EXEMPT, type PathBlocker } from './pathfind';
import { isPodTileBlockedByNode, spawnStructure, spawnUnit } from './state';

const GRID = 64;
// Mirrors step.ts's POD_PATH_BLOCK_SQ — each pod occupies exactly its own tile.
const POD_BLOCK_SQ = rangeSq(fromFloat(0.7));

function pod(x: number, y: number, key = 2): PathBlocker {
  return { x: fromFloat(x), y: fromFloat(y), pathRadiusSq: POD_BLOCK_SQ, key };
}

// Is a tile centre within any blocker's path radius (no exemption)? — validates
// returned waypoints sit on walkable tiles. Pure float, test-only.
function tileOnBlocker(tx: number, ty: number, blockers: PathBlocker[]): boolean {
  for (const b of blockers) {
    const dx = tx - toFloat(b.x);
    const dy = ty - toFloat(b.y);
    if (dx * dx + dy * dy <= toFloat(b.pathRadiusSq)) return true;
  }
  return false;
}

describe('findPath (grid A*)', () => {
  it('returns an empty route when the straight line is clear', () => {
    expect(findPath(fromInt(2), fromInt(5), fromInt(8), fromInt(5), GRID, [pod(20, 20)], NO_EXEMPT)).toEqual([]);
  });

  it('returns an empty route with no blockers', () => {
    expect(findPath(fromInt(2), fromInt(5), fromInt(40), fromInt(40), GRID, [], NO_EXEMPT)).toEqual([]);
  });

  it('routes around a wall of pods, with every waypoint walkable', () => {
    const blockers = [pod(5, 4, 2), pod(5, 5, 3), pod(5, 6, 4)];
    const path = findPath(fromInt(2), fromInt(5), fromInt(8), fromInt(5), GRID, blockers, NO_EXEMPT);
    expect(path.length).toBeGreaterThan(0);
    for (const packed of path) {
      expect(tileOnBlocker(packed % GRID, (packed / GRID) | 0, blockers)).toBe(false);
    }
  });

  it('is deterministic — same inputs give an identical route', () => {
    const blockers = [pod(5, 4, 2), pod(5, 5, 3), pod(5, 6, 4)];
    const a = findPath(fromInt(2), fromInt(5), fromInt(8), fromInt(5), GRID, blockers, NO_EXEMPT);
    const b = findPath(fromInt(2), fromInt(5), fromInt(8), fromInt(5), GRID, blockers, NO_EXEMPT);
    expect(a).toEqual(b);
  });

  it('does not let a diagonal route cut a pod corner', () => {
    // Worker bottom-left, target top-right, pod squarely on the diagonal.
    // A straight diagonal would graze the pod's corner; corner-conservative
    // LoS must reject the clear-shot and route around (non-empty path), and no
    // returned waypoint may sit on the pod tile.
    const blockers = [pod(6, 6, 2)];
    const path = findPath(fromInt(4), fromInt(4), fromInt(8), fromInt(8), GRID, blockers, NO_EXEMPT);
    expect(path.length).toBeGreaterThan(0);
    for (const packed of path) {
      expect(tileOnBlocker(packed % GRID, (packed / GRID) | 0, blockers)).toBe(false);
    }
  });

  it('exempts ONLY the keyed destination blocker, not its neighbours', () => {
    // Destination blocker (key 9) with a solid pod (key 2) across the approach.
    // Exempting key 9 must still route AROUND the pod, not through it.
    const dest: PathBlocker = { x: fromFloat(8), y: fromFloat(5), pathRadiusSq: POD_BLOCK_SQ, key: 9 };
    const blocker = pod(6, 5, 2);
    const path = findPath(fromInt(3), fromInt(5), fromInt(8), fromInt(5), GRID, [dest, blocker], 9);
    expect(path.length).toBeGreaterThan(0);
    for (const packed of path) {
      expect(tileOnBlocker(packed % GRID, (packed / GRID) | 0, [blocker])).toBe(false);
    }
  });
});

describe('tile helpers', () => {
  it('rounds sim coordinates to the nearest tile centre', () => {
    expect(tileAxis(fromFloat(8.0), GRID)).toBe(8);
    expect(tileAxis(fromFloat(8.49), GRID)).toBe(8);
    expect(tileAxis(fromFloat(8.6), GRID)).toBe(9);
    expect(tileAxis(fromFloat(-3), GRID)).toBe(0);
    expect(tileAxis(fromFloat(999), GRID)).toBe(GRID - 1);
  });
  it('packs tiles within range', () => {
    expect(packTile(10, 20, GRID)).toBe(20 * GRID + 10);
  });
});

// ---------------------------------------------------------------------------
// End-to-end regressions on a real Sim.
// ---------------------------------------------------------------------------

function injectOperationalPods(sim: Sim, coords: ReadonlyArray<readonly [number, number]>): void {
  for (const [px, py] of coords) {
    const s = spawnStructure(sim.state, 'workPod', 0, fromInt(px), fromInt(py));
    s.buildTicksRemaining = 0; // operational → counts as a blocker
  }
}

// Assigns a worker to a node and steps until it harvests, tracking whether it
// crossed past the wall and how far it detoured sideways.
function harvestThroughWall(
  sim: Sim,
  workerId: number,
  nodeId: number,
  budget = 2000,
): { reached: boolean; maxXDeviation: number; pastWallY: boolean } {
  sim.step({
    tick: sim.state.tick,
    commands: [{ kind: CommandKind.AssignWorkerToNode, workerId, nodeId }],
  });
  let reached = false;
  let maxXDeviation = 0;
  let pastWallY = false;
  for (let t = 0; t < budget && !reached; t++) {
    sim.step({ tick: sim.state.tick, commands: [] });
    const w = sim.state.units.find((u) => u.id === workerId);
    if (!w || w.kind !== 'worker') break;
    maxXDeviation = Math.max(maxXDeviation, Math.abs(toFloat(w.x) - 10));
    if (toFloat(w.y) > 16) pastWallY = true;
    if (w.phase === 'harvesting' || w.carrying > 0) reached = true;
  }
  return { reached, maxXDeviation, pastWallY };
}

describe('Sim — worker routes around 1-tile pods (A* regression)', () => {
  it('routes around a single pod sitting directly between it and the node', () => {
    const sim = new Sim({
      seed: 7,
      hqs: { faction0: { x: 10, y: 10 }, faction1: { x: 50, y: 50 } },
      nodes: [{ x: 10, y: 20, amount: 1000 }],
      initialEnergy: 10000,
    });
    injectOperationalPods(sim, [[10, 16]]); // dead on the straight line
    const w = spawnUnit(sim.state, 'worker', 0, fromInt(10), fromInt(12));
    const r = harvestThroughWall(sim, w.id, 1);
    expect(r.pastWallY).toBe(true);
    expect(r.reached).toBe(true);
    expect(r.maxXDeviation).toBeGreaterThan(0.5); // stepped aside around the pod
  });

  it('routes around an adjacent-pod wall (1-tile pods, no overlap)', () => {
    // Three pods on adjacent tiles form a genuine 3-tile wall — the only way
    // 1-tile pods can wall a node now that footprints cannot overlap.
    const sim = new Sim({
      seed: 7,
      hqs: { faction0: { x: 10, y: 10 }, faction1: { x: 50, y: 50 } },
      nodes: [{ x: 10, y: 20, amount: 1000 }],
      initialEnergy: 10000,
    });
    injectOperationalPods(sim, [[9, 16], [10, 16], [11, 16]]);
    const w = spawnUnit(sim.state, 'worker', 0, fromInt(10), fromInt(12));
    const r = harvestThroughWall(sim, w.id, 1);
    expect(r.reached).toBe(true);
    expect(r.maxXDeviation).toBeGreaterThan(1); // detoured around the wall end
  });

  it('invalidates the cached path on retarget (no stale-route reuse)', () => {
    // Regression: navigate() caches on the destination tile alone. A retarget
    // whose new goal rounds to the SAME tile as a stale cache must still
    // replan. Simulate a stale cache (a bogus far waypoint + a pathGoalTile
    // equal to the node-centre tile), then assign the worker to that node.
    const sim = new Sim({
      seed: 7,
      hqs: { faction0: { x: 10, y: 10 }, faction1: { x: 50, y: 50 } },
      nodes: [{ x: 10, y: 16, amount: 1000 }],
      initialEnergy: 10000,
    });
    const w = spawnUnit(sim.state, 'worker', 0, fromInt(10), fromInt(12));
    if (w.kind !== 'worker') throw new Error('expected worker');
    w.path = [packTile(20, 20, GRID)];          // stale waypoint far to the +x
    w.pathGoalTile = packTile(10, 16, GRID);     // coincides with the node tile
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.AssignWorkerToNode, workerId: w.id, nodeId: 1 }],
    });
    let maxX = toFloat(w.x);
    for (let t = 0; t < 120; t++) {
      sim.step({ tick: sim.state.tick, commands: [] });
      maxX = Math.max(maxX, toFloat(w.x));
    }
    // Stale reuse would chase (20,20) — x climbing well past 11. A fresh plan
    // keeps the worker in the node/HQ column (x ~10).
    expect(maxX).toBeLessThan(11);
  });

  it('walks the gap between two pods left a tile apart (no longer a wall)', () => {
    // Two pods two tiles apart leave a free centre tile — a real, passable gap
    // now that footprints are 1 tile, so the worker need not detour far.
    const sim = new Sim({
      seed: 7,
      hqs: { faction0: { x: 10, y: 10 }, faction1: { x: 50, y: 50 } },
      nodes: [{ x: 10, y: 20, amount: 1000 }],
      initialEnergy: 10000,
    });
    injectOperationalPods(sim, [[9, 16], [11, 16]]); // gap at x=10
    const w = spawnUnit(sim.state, 'worker', 0, fromInt(10), fromInt(12));
    const r = harvestThroughWall(sim, w.id, 1);
    expect(r.reached).toBe(true);
  });
});

describe('Pod placement keep-out around nodes', () => {
  it('flags the node tile + its 8 neighbours, nothing further', () => {
    const sim = new Sim({
      seed: 7,
      hqs: { faction0: { x: 10, y: 10 }, faction1: { x: 50, y: 50 } },
      nodes: [{ x: 20, y: 20, amount: 1000 }],
      initialEnergy: 10000,
    });
    expect(isPodTileBlockedByNode(sim.state, 20, 20)).toBe(true); // on the node
    expect(isPodTileBlockedByNode(sim.state, 21, 20)).toBe(true); // orthogonal
    expect(isPodTileBlockedByNode(sim.state, 21, 21)).toBe(true); // diagonal
    expect(isPodTileBlockedByNode(sim.state, 22, 20)).toBe(false); // 2 tiles → clear
    expect(isPodTileBlockedByNode(sim.state, 20, 22)).toBe(false);
  });

  it('the sim rejects a BuildStructureByWorker adjacent to a node, accepts it clear', () => {
    const sim = new Sim({
      seed: 7,
      hqs: { faction0: { x: 10, y: 10 }, faction1: { x: 50, y: 50 } },
      nodes: [{ x: 20, y: 20, amount: 1000 }],
      initialEnergy: 10000,
      initialMatter: 10000, // Phase D.1: pods cost matter too.
    });
    const w = spawnUnit(sim.state, 'worker', 0, fromInt(18), fromInt(20));
    const podsBefore = sim.state.structures.length;
    // Adjacent to the node (21,20) → rejected, no structure spawned.
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.BuildStructureByWorker, workerId: w.id, structureKind: 'workPod', x: 21, y: 20 }],
    });
    expect(sim.state.structures.length).toBe(podsBefore);
    // Two tiles clear (22,20) → accepted.
    sim.step({
      tick: sim.state.tick,
      commands: [{ kind: CommandKind.BuildStructureByWorker, workerId: w.id, structureKind: 'workPod', x: 22, y: 20 }],
    });
    expect(sim.state.structures.length).toBe(podsBefore + 1);
  });
});
