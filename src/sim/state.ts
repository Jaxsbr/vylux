// Initial-state factory and entity-lookup helpers.
//
// Lookup uses linear scan rather than a Map<id, index> on purpose:
// (a) entity counts in this spike are small (~tens), (b) array iteration is
// cache-friendly and bit-stable, (c) avoids the Map iteration-order
// question entirely. If profiling later shows this is hot, the upgrade is
// a parallel index array, not a Map.

import { Rng } from './rng';
import type {
  Defender,
  FactionState,
  ProductionBuilding,
  Raider,
  ResourceKind,
  ResourceNode,
  SimState,
  Structure,
  StructureKind,
  SupplyStructure,
  Trail,
  Unit,
  UnitKind,
  UpgradeStructure,
  Vanguard,
  Worker,
} from './types';
import type { Fixed } from './fixed';
import { distSq, fromInt, rangeSq } from './fixed';
import {
  COLOR_NODE_STATS,
  HQ_VISION_RADIUS,
  STRUCTURE_STATS,
  SUPPLY_CAP_INITIAL,
  UNIT_STATS,
} from './units-config';

export interface InitialMatchSpec {
  seed: number | bigint;
  hqs: { faction0: { x: number; y: number }; faction1: { x: number; y: number } };
  // Resource nodes. The legacy `energy` field carries the starting
  // remaining-amount in tiles' worth of resource; `kind` defaults to
  // 'energy' so existing specs keep working unchanged. Phase 3.1 maps
  // place at least one Flux node; Phase 3.5 adds colour ('blue' / 'red')
  // nodes that only the matching faction can harvest.
  nodes: Array<{ x: number; y: number; energy: number; kind?: ResourceKind }>;
  // Energy each faction starts with. 0 by default. Used to bootstrap AI
  // build orders that need to train before any worker has harvested.
  initialEnergy?: number;
  // Flux each faction starts with. 0 by default. Tests that exercise
  // the ResearchTier2 path can pre-fund a faction without harvesting.
  initialFlux?: number;
  // Phase 3.5: colour each faction starts with. 0 by default. Production
  // matches need a non-zero pre-fund (~50) so the bootstrap workers can
  // train before the first colour-node harvest cycle completes; tests
  // that exercise the lockout path can leave it at 0.
  initialColor?: number;
  // Both HQs share the same starting HP, default 500. Lower in tests to
  // produce shorter match-end scenarios.
  hqMaxHp?: number;
}

export function createInitialState(spec: InitialMatchSpec): { state: SimState; rng: Rng } {
  const rng = new Rng(spec.seed);
  const initialEnergy = fromInt(spec.initialEnergy ?? 0);
  const initialFlux = fromInt(spec.initialFlux ?? 0);
  const initialColor = fromInt(spec.initialColor ?? 0);

  const hqMaxHp = fromInt(spec.hqMaxHp ?? 500);
  const factions: [FactionState, FactionState] = [
    {
      hqX: fromInt(spec.hqs.faction0.x),
      hqY: fromInt(spec.hqs.faction0.y),
      energy: initialEnergy,
      flux: initialFlux,
      color: initialColor,
      tier2Researched: false,
      hqHp: hqMaxHp,
      supplyCap: SUPPLY_CAP_INITIAL,
      supplyUsed: 0,
      trailDurationResearched: false,
      nextSpawnRotation: 0,
    },
    {
      hqX: fromInt(spec.hqs.faction1.x),
      hqY: fromInt(spec.hqs.faction1.y),
      energy: initialEnergy,
      flux: initialFlux,
      color: initialColor,
      tier2Researched: false,
      hqHp: hqMaxHp,
      supplyCap: SUPPLY_CAP_INITIAL,
      supplyUsed: 0,
      trailDurationResearched: false,
      nextSpawnRotation: 0,
    },
  ];

  const nodes: ResourceNode[] = spec.nodes.map((n, i) => {
    const kind = n.kind ?? 'energy';
    const remaining = fromInt(n.energy);
    // Phase 3.5: colour nodes carry passive regen + a max-reserve cap.
    // Energy + Flux nodes have regen=0, so their max-reserve doubles
    // as their initial remaining (the cap is a no-op if regen is 0,
    // but keeping the field present means the hash format is uniform
    // across kinds and a future tuning pass for Energy/Flux regen is
    // a one-line change).
    const isColor = kind === 'blue' || kind === 'red';
    return {
      id: i + 1,
      alive: true,
      kind,
      x: fromInt(n.x),
      y: fromInt(n.y),
      remaining,
      regenPerTick: isColor ? COLOR_NODE_STATS.regenPerTick : 0,
      maxReserve: isColor ? COLOR_NODE_STATS.maxReserve : remaining,
      // Phase 3.8: discovery starts false; the constructor below runs
      // an initial sweep so home-base nodes inside HQ vision are
      // pre-discovered. Anything outside that bubble is hidden until
      // a unit / structure walks into LOS.
      discoveredBy: [false, false] as [boolean, boolean],
    };
  });

  const state: SimState = {
    tick: 0,
    rngState: rng.snapshot(),
    factions,
    units: [],
    nodes,
    structures: [],
    trails: [],
    nextEntityId: nodes.length + 1,
    winner: null,
  };

  // Phase 3.8: initial home-base discovery sweep. With no units spawned
  // yet, only the HQs project vision; any node within HQ_VISION_RADIUS
  // of either HQ is marked discoveredBy that faction. This avoids the
  // bootstrap deadlock where the AI can't auto-route workers to harvest
  // (no nodes are discovered) so it never moves anything (so no nodes
  // ever get discovered). Same convenience for the player — they see
  // their own home patch on match start.
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

// Phase 3.7: trails are entities with the same array-with-tombstones
// discipline as units / structures.
export function findTrail(state: SimState, id: number): Trail | null {
  for (let i = 0; i < state.trails.length; i++) {
    const t = state.trails[i];
    if (t.id === id && t.alive) return t;
  }
  return null;
}

export function spawnTrail(state: SimState, ownerFaction: 0 | 1): Trail {
  const id = state.nextEntityId++;
  const t: Trail = {
    id,
    alive: true,
    ownerFaction,
    segments: [],
  };
  state.trails.push(t);
  return t;
}

// Find the first operational (build complete + alive) production
// building owned by the given faction. The "first" tiebreaker is
// array-index order, which is stable because tombstones (alive=false)
// don't shift live indices. Used by player input to pick a default
// training target without forcing a structure-selection UI in 3.0.
export function findFirstOperationalProduction(state: SimState, faction: 0 | 1): ProductionBuilding | null {
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'production') continue;
    if (s.buildTicksRemaining > 0) continue;
    return s;
  }
  return null;
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
    case 'production': {
      const stats = STRUCTURE_STATS.production;
      const s: ProductionBuilding = {
        id,
        alive: true,
        kind: 'production',
        faction,
        x,
        y,
        hp: stats.maxHp,
        buildTicksRemaining: stats.buildTicks,
        trainingKind: null,
        trainTicksRemaining: 0,
        // Phase 3.10.6: BuildStructureByWorker overrides this to true
        // after the spawn returns. Default false so spawnStructure()
        // calls from tests / scripts auto-build via advanceStructure.
        builtByWorker: false,
      };
      state.structures.push(s);
      return s;
    }
    case 'upgrade': {
      const stats = STRUCTURE_STATS.upgrade;
      const s: UpgradeStructure = {
        id,
        alive: true,
        kind: 'upgrade',
        faction,
        x,
        y,
        hp: stats.maxHp,
        buildTicksRemaining: stats.buildTicks,
        researchTicksRemaining: 0,
        // Phase 3.7: idle Spires carry researchKind = null. Set to
        // 'tier2' or 'trailDuration' when the corresponding research
        // command is applied; cleared back to null on completion.
        researchKind: null,
        builtByWorker: false,
      };
      state.structures.push(s);
      return s;
    }
    case 'supply': {
      const stats = STRUCTURE_STATS.supply;
      const s: SupplyStructure = {
        id,
        alive: true,
        kind: 'supply',
        faction,
        x,
        y,
        hp: stats.maxHp,
        buildTicksRemaining: stats.buildTicks,
        builtByWorker: false,
      };
      state.structures.push(s);
      return s;
    }
  }
}

// Phase 3.2: find the faction's first operational + idle upgrade
// structure (build done, no research currently running). Used by the
// player UI + AI to decide whether RESEARCH TIER 2 can be issued.
export function findFirstOperationalUpgrade(state: SimState, faction: 0 | 1): UpgradeStructure | null {
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'upgrade') continue;
    if (s.buildTicksRemaining > 0) continue;
    if (s.researchTicksRemaining > 0) continue;
    return s;
  }
  return null;
}

// Find the faction's first owned upgrade structure regardless of state
// (still building / idle / researching). Used by the AI to avoid
// queueing a second Spire while the first is still going up.
export function findFirstUpgradeAnyState(state: SimState, faction: 0 | 1): UpgradeStructure | null {
  for (let i = 0; i < state.structures.length; i++) {
    const s = state.structures[i];
    if (!s.alive) continue;
    if (s.faction !== faction) continue;
    if (s.kind !== 'upgrade') continue;
    return s;
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
        moveTarget: null,
        phase: 'idle',
        targetNodeId: 0,
        carrying: 0,
        // Default kind on spawn. Reset to a canonical value any time
        // carrying drops to 0 so determinism doesn't depend on
        // historical choice — see step.ts apply-deposit + on-death
        // resets.
        carriedKind: 'energy',
        harvestTicksRemaining: 0,
        // Phase 3.7: dump fields default to 0/0/0 ("not dumping, no
        // active trail, no cooldown"). All three reset on death too.
        dumpTicksRemaining: 0,
        dumpCooldownTicks: 0,
        activeTrailId: 0,
        // Phase 3.10.6: not on a build task by default. The
        // BuildStructureByWorker / AssignWorkerToBuild commands flip
        // phase = 'building' + targetStructureId; on build complete +
        // on death the field resets to 0.
        targetStructureId: 0,
        // Phase 3.10.10d: harvest slot — picked at AssignWorkerToNode
        // time. Default 0 on spawn (no node assigned).
        targetNodeSlot: 0,
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
        moveTarget: null,
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
        moveTarget: null,
      };
      unit = r;
      break;
    }
    case 'vanguard': {
      const v: Vanguard = {
        id,
        alive: true,
        kind: 'vanguard',
        faction,
        x,
        y,
        hp: stats.maxHp,
        attackCooldown: 0,
        moveTarget: null,
      };
      unit = v;
      break;
    }
  }

  state.units.push(unit);
  // Phase 3.6: spawnUnit DOES NOT bump supplyUsed. The caller bumps,
  // because the supply accounting needs to reflect when the slot was
  // reserved, not when the body materialises:
  //   - TrainUnit (instant): bump now (queue == spawn)
  //   - TrainAtStructure: bump at QUEUE time, not at spawn time (so a
  //     second TrainAtStructure command can't double-book the slot
  //     mid-train). Spawn-from-advanceStructure intentionally skips
  //     the bump because the slot was already reserved.
  //   - SpawnUnit (dev-only command): bump now.
  // Decrement happens in step.applyDamage on death.
  return unit;
}
