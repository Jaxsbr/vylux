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
import type {
  ResourceKind,
  SimState,
  Structure,
  StructureKind,
  Unit,
  UnitKind,
  WorkerPhase,
} from './types';

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
      h.writeU32(fs.factionId === 'swarm' ? 0 : 1);
      h.writeI32(fs.hqX);
      h.writeI32(fs.hqY);
      h.writeI32(fs.energy);
      h.writeI32(fs.hqHp);
      h.writeU32(fs.nextSpawnRotation);
      // Phase C.1: supply cap + used.
      h.writeU32(fs.supplyCap);
      h.writeU32(fs.supplyUsed);
      // Phase C.1 research: 0 = idle, 1 = auto-resume mid-research.
      // Extend this dispatch as new research kinds land.
      h.writeU32(fs.researchingKind === null ? 0 : 1);
      h.writeU32(fs.researchTicksRemaining);
      h.writeU32(fs.autoResumeResearched ? 1 : 0);
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
      h.writeU32(n.discoveredBy[0] ? 1 : 0);
      h.writeU32(n.discoveredBy[1] ? 1 : 0);
    }

    // Phase C.1: structures (work pods).
    h.writeU32(s.structures.length);
    for (let i = 0; i < s.structures.length; i++) {
      hashStructure(h, s.structures[i]);
    }

    return h.digestHex();
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
  h.writeI32(u.hp);
  h.writeU32(u.attackCooldown);
  // moveTarget — presence flag + xy. null hashes the same for every unit
  // (0, 0, 0) so the slot is uniform across kinds.
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
      h.writeU32(u.targetNodeSlot);
      // Phase C.1: per-worker charge + build / charge target.
      h.writeU32(u.charge);
      h.writeU32(u.maxCharge);
      h.writeU32(u.targetStructureId);
      h.writeU32(u.chargeTargetStructureId);
      h.writeU32(u.chargeTicksAccrued);
      // Phase C.1 auto-resume: previous harvest node (0 = none).
      h.writeU32(u.previousNodeId);
      // Phase C.1 charge-slot allocation: slot index at the chosen
      // charge spot. Cleared (= 0) when not in charge mode.
      h.writeU32(u.chargeSlot);
      return;
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
    case 'workPod':
      h.writeU32(s.buildTicksRemaining);
      return;
  }
}

function structureKindToInt(kind: StructureKind): number {
  switch (kind) {
    case 'workPod': return 0;
  }
}

function resourceKindToInt(kind: ResourceKind): number {
  switch (kind) {
    case 'energy': return 0;
  }
}

function unitKindToInt(kind: UnitKind): number {
  switch (kind) {
    case 'worker': return 0;
  }
}

function workerPhaseToInt(phase: WorkerPhase): number {
  switch (phase) {
    case 'idle': return 0;
    case 'movingToNode': return 1;
    case 'harvesting': return 2;
    case 'returning': return 3;
    case 'movingToBuildSite': return 4;
    case 'building': return 5;
    case 'walkingToCharge': return 6;
    case 'charging': return 7;
  }
}
