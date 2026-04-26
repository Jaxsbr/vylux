// Initial-state factory and entity-lookup helpers.
//
// Lookup uses linear scan rather than a Map<id, index> on purpose:
// (a) entity counts in this spike are small (~tens), (b) array iteration is
// cache-friendly and bit-stable, (c) avoids the Map iteration-order
// question entirely. If profiling later shows this is hot, the upgrade is
// a parallel index array, not a Map.

import { Rng } from './rng';
import type { Defender, EnergyNode, FactionState, Raider, SimState, Unit, UnitKind, Worker } from './types';
import type { Fixed } from './fixed';
import { fromInt } from './fixed';
import { UNIT_STATS } from './units-config';

export interface InitialMatchSpec {
  seed: number | bigint;
  hqs: { faction0: { x: number; y: number }; faction1: { x: number; y: number } };
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
  const factions: [FactionState, FactionState] = [
    {
      hqX: fromInt(spec.hqs.faction0.x),
      hqY: fromInt(spec.hqs.faction0.y),
      energy: initialEnergy,
      hqHp: hqMaxHp,
      points: 0,
    },
    {
      hqX: fromInt(spec.hqs.faction1.x),
      hqY: fromInt(spec.hqs.faction1.y),
      energy: initialEnergy,
      hqHp: hqMaxHp,
      points: 0,
    },
  ];

  const nodes: EnergyNode[] = spec.nodes.map((n, i) => ({
    id: i + 1,
    alive: true,
    x: fromInt(n.x),
    y: fromInt(n.y),
    remaining: fromInt(n.energy),
  }));

  const state: SimState = {
    tick: 0,
    rngState: rng.snapshot(),
    factions,
    units: [],
    nodes,
    nextEntityId: nodes.length + 1,
    winner: null,
  };

  return { state, rng };
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

export function findNode(state: SimState, id: number): EnergyNode | null {
  for (let i = 0; i < state.nodes.length; i++) {
    const n = state.nodes[i];
    if (n.id === id && n.alive) return n;
  }
  return null;
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
  let unit: Unit;

  switch (kind) {
    case 'worker': {
      const w: Worker = {
        id,
        alive: true,
        kind: 'worker',
        faction,
        x,
        y,
        hp: stats.maxHp,
        attackCooldown: 0,
        phase: 'idle',
        targetNodeId: 0,
        carrying: 0,
        harvestTicksRemaining: 0,
      };
      unit = w;
      break;
    }
    case 'defender': {
      const d: Defender = {
        id,
        alive: true,
        kind: 'defender',
        faction,
        x,
        y,
        hp: stats.maxHp,
        attackCooldown: 0,
      };
      unit = d;
      break;
    }
    case 'raider': {
      const r: Raider = {
        id,
        alive: true,
        kind: 'raider',
        faction,
        x,
        y,
        hp: stats.maxHp,
        attackCooldown: 0,
      };
      unit = r;
      break;
    }
  }

  state.units.push(unit);
  return unit;
}
