// Initial-state factory and entity-lookup helpers.
//
// Lookup uses linear scan rather than a Map<id, index> on purpose:
// (a) entity counts are small, (b) array iteration is cache-friendly
// and bit-stable, (c) avoids the Map iteration-order question entirely.

import { Rng } from './rng';
import type {
  FactionId,
  FactionState,
  ResourceKind,
  ResourceNode,
  SimState,
  Structure,
  StructureKind,
  Unit,
  UnitKind,
  Worker,
  WorkPod,
} from './types';
import type { Fixed } from './fixed';
import { distSq, fromInt, rangeSq, toInt } from './fixed';
import {
  HQ_SUPPLY_CAP_INITIAL,
  HQ_VISION_RADIUS,
  POD_HQ_KEEPOUT_TILES,
  POD_NODE_KEEPOUT_TILES,
  STRUCTURE_STATS,
  WORKER_DEFAULT_MAX_CHARGE,
  unitStatsFor,
} from './units-config';

export interface InitialMatchSpec {
  seed: number | bigint;
  // Phase C.6.6: square grid extent (tiles per side) for A* pathfinding.
  // Defaults to 64 (the live arena) so existing callers — tests, scripted
  // matches whose coords sit well within 64 — need no change. The render
  // passes GRID_CONSTANTS.gridSize so sim + render agree.
  gridSize?: number;
  hqs: { faction0: { x: number; y: number }; faction1: { x: number; y: number } };
  // Which faction-id each slot plays. Defaults to swarm/siege so legacy
  // callers (tests + headless cli) don't have to spell it out.
  factionIds?: { faction0: FactionId; faction1: FactionId };
  // Resource nodes. Phase D.1: nodes carry a `kind` (energy | matter) and a
  // kind-neutral `amount` (the starting reserve). `kind` is optional and
  // defaults to 'energy' so legacy specs / tests that predate matter stay
  // valid. (Field renamed from `energy` to `amount` in D.1 — a matter node
  // carrying `energy: 120` read wrong, and the rename is part of the
  // stop-overloading-"energy" cleanup.)
  nodes: Array<{ x: number; y: number; amount: number; kind?: ResourceKind }>;
  // Energy each faction starts with. 0 by default. Used to bootstrap AI
  // build orders that need to train before any worker has harvested.
  initialEnergy?: number;
  // Phase D.1: Matter each faction starts with. 0 by default — a normal
  // match earns its matter from tick 0 (the worker is energy-only, so
  // matter isn't bootstrap-critical). The tutorial sets it so its
  // build-a-pod step never blocks on matter.
  initialMatter?: number;
  // Both HQs share the same starting HP, default 500. Lower in tests to
  // produce shorter match-end scenarios.
  hqMaxHp?: number;
  // Scored-match length in sim ticks. When set (>0), the match also ends
  // at this tick (or early if the whole field is mined out), awarding the
  // win to the higher faction score with a deterministic tie-break. When
  // unset / 0 the match has no timer and only HQ-destruction / Resign can
  // end it — preserving classic behavior for tests, the tutorial, and the
  // determinism-gate scripted matches. PvA / observe / lockstep opt in.
  matchLengthTicks?: number;
}

export function createInitialState(spec: InitialMatchSpec): { state: SimState; rng: Rng } {
  const rng = new Rng(spec.seed);
  const initialEnergy = fromInt(spec.initialEnergy ?? 0);
  const initialMatter = fromInt(spec.initialMatter ?? 0);

  const hqMaxHp = fromInt(spec.hqMaxHp ?? 500);
  const factionId0 = spec.factionIds?.faction0 ?? 'swarm';
  const factionId1 = spec.factionIds?.faction1 ?? 'siege';
  const factions: [FactionState, FactionState] = [
    {
      factionId: factionId0,
      hqX: fromInt(spec.hqs.faction0.x),
      hqY: fromInt(spec.hqs.faction0.y),
      energy: initialEnergy,
      matter: initialMatter,
      matterHarvested: fromInt(0),
      energyHarvested: fromInt(0),
      hqHp: hqMaxHp,
      nextSpawnRotation: 0,
      supplyCap: HQ_SUPPLY_CAP_INITIAL,
      supplyUsed: 0,
      researchingKind: null,
      researchTicksRemaining: 0,
      autoResumeResearched: false,
      trainQueue: [],
      trainTicksRemaining: 0,
    },
    {
      factionId: factionId1,
      hqX: fromInt(spec.hqs.faction1.x),
      hqY: fromInt(spec.hqs.faction1.y),
      energy: initialEnergy,
      matter: initialMatter,
      matterHarvested: fromInt(0),
      energyHarvested: fromInt(0),
      hqHp: hqMaxHp,
      nextSpawnRotation: 0,
      supplyCap: HQ_SUPPLY_CAP_INITIAL,
      supplyUsed: 0,
      researchingKind: null,
      researchTicksRemaining: 0,
      autoResumeResearched: false,
      trainQueue: [],
      trainTicksRemaining: 0,
    },
  ];

  const nodes: ResourceNode[] = spec.nodes.map((n, i) => ({
    id: i + 1,
    alive: true,
    kind: (n.kind ?? 'energy') as ResourceKind,
    x: fromInt(n.x),
    y: fromInt(n.y),
    remaining: fromInt(n.amount),
    discoveredBy: [false, false] as [boolean, boolean],
  }));

  const gridSize = spec.gridSize ?? 64;
  const tileCount = gridSize * gridSize;
  const state: SimState = {
    tick: 0,
    rngState: rng.snapshot(),
    gridSize,
    matchLengthTicks: spec.matchLengthTicks ?? 0,
    factions,
    units: [],
    nodes,
    structures: [],
    explored: [new Uint8Array(tileCount), new Uint8Array(tileCount)],
    nextEntityId: nodes.length + 1,
    winner: null,
  };

  // Initial home-base discovery sweep. With no units spawned yet, only
  // the HQs project vision; any node within HQ_VISION_RADIUS of either
  // HQ is marked discoveredBy that faction. Avoids the bootstrap deadlock
  // where the AI can't auto-route workers (no nodes are discovered) so
  // it never moves anything (so no nodes ever get discovered).
  initialHqDiscovery(state);

  // Phase C.6.7: same bootstrap for the tile-level explored set — seed
  // each faction's fog with the area its HQ already sees, so the home
  // patch isn't fogged at match start (mirrors initialHqDiscovery, but
  // for tiles rather than nodes).
  initialHqExploration(state);

  return { state, rng };
}

function initialHqDiscovery(state: SimState): void {
  const rSq = rangeSq(HQ_VISION_RADIUS);
  for (const f of [0, 1] as const) {
    const fs = state.factions[f];
    for (const node of state.nodes) {
      const dSq = distSq(node.x, node.y, fs.hqX, fs.hqY);
      if (dSq <= rSq) node.discoveredBy[f] = true;
    }
  }
}

// Phase C.6.7: mark every tile whose centre falls within `r` of (cx, cy)
// as explored in `explored`. Tile centres sit on integer sim coords
// (fromInt(tile)) — the pathfind convention (pathfind.ts tileCenter) —
// so the explored set aligns with the grid workers path on. Permanent:
// a tile already set is left alone (the early-out also bounds the work).
// Deterministic: integer box bounds + exact Fixed distSq, no floats.
export function markExploredCircle(
  explored: Uint8Array,
  gridSize: number,
  cx: Fixed,
  cy: Fixed,
  r: Fixed,
): void {
  const rSq = rangeSq(r);
  // +1 tile of slack on the integer bounding box so the exact distSq
  // filter inside never misses a qualifying tile at the rim.
  const reach = toInt(r) + 1;
  const cxi = toInt(cx);
  const cyi = toInt(cy);
  const txMin = Math.max(0, cxi - reach);
  const txMax = Math.min(gridSize - 1, cxi + reach);
  const tyMin = Math.max(0, cyi - reach);
  const tyMax = Math.min(gridSize - 1, cyi + reach);
  for (let ty = tyMin; ty <= tyMax; ty++) {
    const rowBase = ty * gridSize;
    const tcy = fromInt(ty);
    for (let tx = txMin; tx <= txMax; tx++) {
      const idx = rowBase + tx;
      if (explored[idx] === 1) continue;
      if (distSq(fromInt(tx), tcy, cx, cy) <= rSq) explored[idx] = 1;
    }
  }
}

function initialHqExploration(state: SimState): void {
  for (const f of [0, 1] as const) {
    const fs = state.factions[f];
    markExploredCircle(state.explored[f], state.gridSize, fs.hqX, fs.hqY, HQ_VISION_RADIUS);
  }
}

export function findUnit(state: SimState, id: number): Unit | null {
  for (let i = 0; i < state.units.length; i++) {
    const u = state.units[i];
    if (u.id === id && u.alive) return u;
  }
  return null;
}

export function findWorker(state: SimState, id: number): Worker | null {
  const u = findUnit(state, id);
  return u && u.kind === 'worker' ? u : null;
}

export function findNode(state: SimState, id: number): ResourceNode | null {
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (n.id === id && n.alive) return n;
  }
  return null;
}

// Phase C.6.6: is tile (tileX, tileY) too close to a live energy node to build
// a work pod on? True when within POD_NODE_KEEPOUT_TILES (Chebyshev) of any
// alive node. Shared by the authoritative build reject (step.ts), the AI's pod
// tile pick (ai.ts), and the render placement preview — one source of truth so
// the preview can't disagree with what the sim accepts. Tile coords are
// integers; node coords sit on integer tiles, so toInt recovers the node tile.
export function isPodTileBlockedByNode(state: SimState, tileX: number, tileY: number): boolean {
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (!n.alive) continue;
    const dx = Math.abs(tileX - toInt(n.x));
    const dy = Math.abs(tileY - toInt(n.y));
    if (dx <= POD_NODE_KEEPOUT_TILES && dy <= POD_NODE_KEEPOUT_TILES) return true;
  }
  return false;
}

// True when tile (tileX, tileY) is too close to EITHER HQ to build a work pod —
// within POD_HQ_KEEPOUT_TILES (Chebyshev), i.e. on the HQ's 3×3 footprint or the
// clear ring around it. Keeps structures from being glued to a base. Shared by
// the authoritative build reject (step.ts), the AI tile pick (ai.ts), and the
// render placement preview, same as isPodTileBlockedByNode.
export function isPodTileBlockedByHq(state: SimState, tileX: number, tileY: number): boolean {
  for (let f = 0; f < state.factions.length; f++) {
    const fs = state.factions[f];
    const dx = Math.abs(tileX - toInt(fs.hqX));
    const dy = Math.abs(tileY - toInt(fs.hqY));
    if (dx <= POD_HQ_KEEPOUT_TILES && dy <= POD_HQ_KEEPOUT_TILES) return true;
  }
  return false;
}

// Phase C.6.8/9: has `faction` explored every tile on the map? Drives the
// Scout button's enabled state (nothing left to scout once true) and the
// AI's decision to stop dispatching scouts. Cheap full scan of the bitmap;
// early-outs on the first unexplored tile.
export function isFullyExplored(state: SimState, faction: 0 | 1): boolean {
  const e = state.explored[faction];
  for (let i = 0; i < e.length; i++) {
    if (e[i] === 0) return false;
  }
  return true;
}

export function findStructure(state: SimState, id: number): Structure | null {
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (s.id === id && s.alive) return s;
  }
  return null;
}

// Phase C.1: the nearest friendly OPERATIONAL work pod for a worker at
// (x, y). "Operational" = alive AND buildTicksRemaining === 0. Returns
// null if no such pod exists; callers fall back to the friendly HQ.
export function findNearestFriendlyOperationalWorkPod(
  state: SimState,
  faction: 0 | 1,
  x: Fixed,
  y: Fixed,
): WorkPod | null {
  let best: WorkPod | null = null;
  let bestD: Fixed = 0;
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.kind !== 'workPod') continue;
    if (s.faction !== faction) continue;
    if (s.buildTicksRemaining > 0) continue;
    const d = distSq(x, y, s.x, s.y);
    if (best === null || d < bestD || (d === bestD && s.id < best.id)) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

export function spawnUnit(
  state: SimState,
  kind: UnitKind,
  faction: 0 | 1,
  x: Fixed,
  y: Fixed,
): Unit {
  // Phase C.2: source maxHp from the per-faction stat block (Swarm 30 /
  // Siege 60) rather than the shared baseline — the spawn path previously
  // ignored the documented asymmetry and gave every worker 40 HP.
  const stats = unitStatsFor(state.factions[faction].factionId, kind);
  const id = state.nextEntityId++;
  const w: Worker = {
    id,
    alive: true,
    kind: 'worker',
    faction,
    x,
    y,
    hp: stats.maxHp,
    attackCooldown: 0,
    moveTarget: null,
    phase: 'idle',
    targetNodeId: 0,
    carrying: 0,
    carriedKind: 'energy',
    harvestTicksRemaining: 0,
    targetNodeSlot: 0,
    charge: WORKER_DEFAULT_MAX_CHARGE,
    maxCharge: WORKER_DEFAULT_MAX_CHARGE,
    targetStructureId: 0,
    chargeTargetStructureId: 0,
    chargeTicksAccrued: 0,
    previousNodeId: 0,
    chargeSlot: 0,
    path: [],
    pathGoalTile: -1,
    idleTicks: 0,
  };
  state.units.push(w);
  return w;
}

export function spawnStructure(
  state: SimState,
  kind: StructureKind,
  faction: 0 | 1,
  x: Fixed,
  y: Fixed,
): Structure {
  const id = state.nextEntityId++;
  switch (kind) {
    case 'workPod': {
      const stats = STRUCTURE_STATS.workPod;
      const s: WorkPod = {
        id,
        alive: true,
        kind: 'workPod',
        faction,
        x,
        y,
        hp: stats.maxHp,
        buildTicksRemaining: stats.buildTicks,
      };
      state.structures.push(s);
      return s;
    }
  }
}
