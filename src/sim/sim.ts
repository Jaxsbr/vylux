// Public sim entry point. Wraps initial-state construction, the per-tick
// step, and canonical state hashing.
//
// Usage in a real client:
//   const sim = new Sim(spec);
//   for each input frame: sim.step(frame); record sim.stateHash();
//
// Usage in the headless harness:
//   identical, except we feed pre-recorded frames and compare stateHash()
//   to a golden log.

import { Hasher } from './hash';
import { Rng } from './rng';
import { createInitialState, type InitialMatchSpec } from './state';
import { step } from './step';
import type { InputFrame } from './commands';
import type { ResourceKind, SimState, Structure, Trail, Unit, UnitKind, WorkerPhase } from './types';

export class Sim {
  readonly state: SimState;
  private readonly rng: Rng;

  constructor(spec: InitialMatchSpec) {
    const init = createInitialState(spec);
    this.state = init.state;
    this.rng = init.rng;
  }

  step(frame: InputFrame): void {
    step(this.state, this.rng, frame);
  }

  // Canonical hash of the entire sim state. The serialisation order here
  // is the sim's determinism contract — change it and you invalidate
  // every existing replay. Versioning that boundary lives in the replay
  // format, not in this function.
  stateHash(): string {
    const h = new Hasher();
    const s = this.state;

    h.writeU32(s.tick);
    h.writeU64(s.rngState);
    h.writeU32(s.nextEntityId);
    h.writeI32(s.winner === null ? -1 : s.winner);

    // Factions — fixed length 2, fixed field order.
    for (let f = 0; f < 2; f++) {
      const fs = s.factions[f];
      // Phase 3.11b: faction-id discriminator. 0 = swarm, 1 = siege.
      // Hashed so a swarm-vs-siege match can't be replayed as
      // siege-vs-swarm — the per-faction stat overrides would diverge
      // and the replay would desync. REPLAY_VERSION bumps to 19.
      h.writeU32(fs.factionId === 'swarm' ? 0 : 1);
      h.writeI32(fs.hqX);
      h.writeI32(fs.hqY);
      h.writeI32(fs.energy);
      h.writeI32(fs.flux);
      h.writeI32(fs.color);
      h.writeU32(fs.tier2Researched ? 1 : 0);
      h.writeI32(fs.hqHp);
      // Phase 3.10.8 (2026-05-07 PvE pivot cleanup): the previous slot
      // here was `points` — removed with the points-threshold win
      // condition. REPLAY_VERSION bumps to 11 to mark the hash shape
      // change.
      // Phase 3.6: supply accounting. supplyCap is derived from
      // operational Pylons each end-of-step but stored on FactionState
      // so the hash captures the current cap directly.
      h.writeU32(fs.supplyCap);
      h.writeU32(fs.supplyUsed);
      // Phase 3.7: trail-duration research flag.
      h.writeU32(fs.trailDurationResearched ? 1 : 0);
      // Phase 3.10.4: round-robin index for HQ-perimeter spawn.
      h.writeU32(fs.nextSpawnRotation);
    }

    // Units — array order is the sim's iteration order; tombstones
    // (alive=false) are kept so removed entries don't shift live indices.
    h.writeU32(s.units.length);
    for (let i = 0; i < s.units.length; i++) {
      hashUnit(h, s.units[i]);
    }

    // Nodes.
    h.writeU32(s.nodes.length);
    for (let i = 0; i < s.nodes.length; i++) {
      const n = s.nodes[i];
      h.writeU32(n.id);
      h.writeU32(n.alive ? 1 : 0);
      h.writeU32(resourceKindToInt(n.kind));
      h.writeI32(n.x);
      h.writeI32(n.y);
      h.writeI32(n.remaining);
      // Phase 3.5: regen + cap. Hashed unconditionally (energy/flux
      // nodes carry 0 / initial-remaining, colour nodes carry the
      // tuned values from COLOR_NODE_STATS).
      h.writeI32(n.regenPerTick);
      h.writeI32(n.maxReserve);
      // Phase 3.8: per-faction discovery flag. Permanent — once true,
      // never cleared — so the hash captures the cumulative scouting
      // history.
      h.writeU32(n.discoveredBy[0] ? 1 : 0);
      h.writeU32(n.discoveredBy[1] ? 1 : 0);
    }

    // Structures (Phase 3.0+). Same array-with-tombstones discipline as
    // units; consumers must iterate in stored order. Adding this field
    // moves the canonical hash and invalidates pre-3.0 golden fixtures.
    h.writeU32(s.structures.length);
    for (let i = 0; i < s.structures.length; i++) {
      hashStructure(h, s.structures[i]);
    }

    // Trails (Phase 3.7+). Same array-with-tombstones discipline.
    // Each trail's segments hash is dynamic-length (count then payload)
    // so a tick-by-tick growing trail produces a hash that responds.
    h.writeU32(s.trails.length);
    for (let i = 0; i < s.trails.length; i++) {
      hashTrail(h, s.trails[i]);
    }

    return h.digestHex();
  }
}

function hashTrail(h: Hasher, t: Trail): void {
  h.writeU32(t.id);
  h.writeU32(t.alive ? 1 : 0);
  h.writeU32(t.ownerFaction);
  h.writeU32(t.segments.length);
  for (let i = 0; i < t.segments.length; i++) {
    const seg = t.segments[i];
    h.writeI32(seg.x);
    h.writeI32(seg.y);
    h.writeU32(seg.age);
  }
}

function hashStructure(h: Hasher, s: Structure): void {
  h.writeU32(s.id);
  h.writeU32(s.alive ? 1 : 0);
  h.writeU32(s.faction);
  h.writeU32(structureKindToInt(s.kind));
  h.writeI32(s.x);
  h.writeI32(s.y);
  h.writeI32(s.hp);
  switch (s.kind) {
    case 'production':
      h.writeU32(s.buildTicksRemaining);
      h.writeU32(s.trainingKind === null ? 0 : unitKindToInt(s.trainingKind) + 1);
      h.writeU32(s.trainTicksRemaining);
      // Phase 3.10.6: worker-driven build flag.
      h.writeU32(s.builtByWorker ? 1 : 0);
      return;
    case 'upgrade':
      h.writeU32(s.buildTicksRemaining);
      h.writeU32(s.researchTicksRemaining);
      h.writeU32(
        s.researchKind === null ? 0 :
        s.researchKind === 'tier2' ? 1 :
        2,
      );
      h.writeU32(s.builtByWorker ? 1 : 0);
      return;
    case 'supply':
      h.writeU32(s.buildTicksRemaining);
      h.writeU32(s.builtByWorker ? 1 : 0);
      return;
  }
}

function structureKindToInt(kind: Structure['kind']): number {
  switch (kind) {
    case 'production': return 0;
    case 'upgrade': return 1;
    case 'supply': return 2;
  }
}

function hashUnit(h: Hasher, u: Unit): void {
  // Common fields, fixed order. Per-kind extras follow.
  h.writeU32(u.id);
  h.writeU32(u.alive ? 1 : 0);
  h.writeU32(u.faction);
  h.writeU32(unitKindToInt(u.kind));
  h.writeI32(u.x);
  h.writeI32(u.y);
  // Phase 3.10.10e: the per-unit velocity (vx, vy) and lateral-bias
  // fields added in 3.10.10 + 3.10.10b were dropped along with the
  // collision / friction passes they fed. Movement is back to chebyshev
  // step-toward-target; only x, y are hashed for unit position.
  h.writeI32(u.hp);
  h.writeU32(u.attackCooldown);
  // Phase 3.3: moveTarget — presence flag + xy. null hashes the same
  // for every unit (0,0,0) so the slot is uniform across kinds. Cleared
  // on death (in step.applyDamage) so dead units are also canonical.
  if (u.moveTarget === null) {
    h.writeU32(0);
    h.writeI32(0);
    h.writeI32(0);
  } else {
    h.writeU32(1);
    h.writeI32(u.moveTarget.x);
    h.writeI32(u.moveTarget.y);
  }

  switch (u.kind) {
    case 'worker':
      h.writeU32(workerPhaseToInt(u.phase));
      h.writeU32(u.targetNodeId);
      h.writeI32(u.carrying);
      h.writeU32(resourceKindToInt(u.carriedKind));
      h.writeU32(u.harvestTicksRemaining);
      // Phase 3.7: dump state. All three reset to 0 on death so dead
      // workers carry canonical zeros into the hash.
      h.writeU32(u.dumpTicksRemaining);
      h.writeU32(u.dumpCooldownTicks);
      h.writeU32(u.activeTrailId);
      // Phase 3.10.6: structure id this worker is building (0 = none).
      h.writeU32(u.targetStructureId);
      // Phase 3.10.10d: harvest slot index (0..HARVEST_SLOT_COUNT-1).
      h.writeU32(u.targetNodeSlot);
      return;
    case 'defender':
    case 'raider':
    case 'vanguard':
      // No kind-specific fields beyond UnitBase. Keep the slot in case
      // the layout grows; for now nothing to write.
      return;
  }
}

function resourceKindToInt(kind: ResourceKind): number {
  switch (kind) {
    case 'energy': return 0;
    case 'flux': return 1;
    case 'blue': return 2;
    case 'red': return 3;
  }
}

function unitKindToInt(kind: UnitKind): number {
  switch (kind) {
    case 'worker': return 0;
    case 'defender': return 1;
    case 'raider': return 2;
    case 'vanguard': return 3;
  }
}

function workerPhaseToInt(phase: WorkerPhase): number {
  switch (phase) {
    case 'idle': return 0;
    case 'movingToNode': return 1;
    case 'harvesting': return 2;
    case 'returning': return 3;
    case 'building': return 4;
  }
}
