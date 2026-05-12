// Initial-state factory and entity-lookup helpers.
//
// Lookup uses linear scan rather than a Map<id, index> on purpose:
// (a) entity counts are small, (b) array iteration is cache-friendly
// and bit-stable, (c) avoids the Map iteration-order question entirely.

import { Rng } from './rng';
import type {
  FactionId,
  FactionState,
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
import { distSq, fromInt, rangeSq } from './fixed';
import {
  HQ_SUPPLY_CAP_INITIAL,
  HQ_VISION_RADIUS,
  STRUCTURE_STATS,
  UNIT_STATS,
  WORKER_DEFAULT_MAX_CHARGE,
} from './units-config';

export interface InitialMatchSpec {
  seed: number | bigint;
  hqs: { faction0: { x: number; y: number }; faction1: { x: number; y: number } };
  // Which faction-id each slot plays. Defaults to swarm/siege so legacy
  // callers (tests + headless cli) don't have to spell it out.
  factionIds?: { faction0: FactionId; faction1: FactionId };
  // Resource nodes. Phase A: only 'energy' nodes are valid; the kind
  // field is dropped from the input shape since there's no other choice.
  nodes: Array<{ x: number; y: number; energy: number }>;
  // Energy each faction starts with. 0 by default. Used to bootstrap AI
  // build orders that need to train before any worker has harvested.
  initialEnergy?: number;
  // Both HQs share the same starting HP, default 500. Lower in tests to
  // produce shorter match-end scenarios.
  hqMaxHp?: number;
}

export function createInitialState(spec: InitialMatchSpec): { state: SimState; rng: Rng } {
  const rng = new Rng(spec.seed);
  const initialEnergy = fromInt(spec.initialEnergy ?? 0);

  const hqMaxHp = fromInt(spec.hqMaxHp ?? 500);
  const factionId0 = spec.factionIds?.faction0 ?? 'swarm';
  const factionId1 = spec.factionIds?.faction1 ?? 'siege';
  const factions: [FactionState, FactionState] = [
    {
      factionId: factionId0,
      hqX: fromInt(spec.hqs.faction0.x),
      hqY: fromInt(spec.hqs.faction0.y),
      energy: initialEnergy,
      hqHp: hqMaxHp,
      nextSpawnRotation: 0,
      supplyCap: HQ_SUPPLY_CAP_INITIAL,
      supplyUsed: 0,
      researchingKind: null,
      researchTicksRemaining: 0,
      autoResumeResearched: false,
    },
    {
      factionId: factionId1,
      hqX: fromInt(spec.hqs.faction1.x),
      hqY: fromInt(spec.hqs.faction1.y),
      energy: initialEnergy,
      hqHp: hqMaxHp,
      nextSpawnRotation: 0,
      supplyCap: HQ_SUPPLY_CAP_INITIAL,
      supplyUsed: 0,
      researchingKind: null,
      researchTicksRemaining: 0,
      autoResumeResearched: false,
    },
  ];

  const nodes: ResourceNode[] = spec.nodes.map((n, i) => ({
    id: i + 1,
    alive: true,
    kind: 'energy' as const,
    x: fromInt(n.x),
    y: fromInt(n.y),
    remaining: fromInt(n.energy),
    discoveredBy: [false, false] as [boolean, boolean],
  }));

  const state: SimState = {
    tick: 0,
    rngState: rng.snapshot(),
    factions,
    units: [],
    nodes,
    structures: [],
    nextEntityId: nodes.length + 1,
    winner: null,
  };

  // Initial home-base discovery sweep. With no units spawned yet, only
  // the HQs project vision; any node within HQ_VISION_RADIUS of either
  // HQ is marked discoveredBy that faction. Avoids the bootstrap deadlock
  // where the AI can't auto-route workers (no nodes are discovered) so
  // it never moves anything (so no nodes ever get discovered).
  initialHqDiscovery(state);

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
  const stats = UNIT_STATS[kind];
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
