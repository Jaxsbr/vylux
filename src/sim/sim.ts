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
import type { SimState, Unit, UnitKind, WorkerPhase } from './types';

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
      h.writeI32(fs.hqX);
      h.writeI32(fs.hqY);
      h.writeI32(fs.energy);
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
      h.writeI32(n.x);
      h.writeI32(n.y);
      h.writeI32(n.remaining);
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

  switch (u.kind) {
    case 'worker':
      h.writeU32(workerPhaseToInt(u.phase));
      h.writeU32(u.targetNodeId);
      h.writeI32(u.carrying);
      h.writeU32(u.harvestTicksRemaining);
      return;
    case 'defender':
    case 'raider':
      // No kind-specific fields beyond UnitBase. Keep the slot in case
      // the layout grows; for now nothing to write.
      return;
  }
}

function unitKindToInt(kind: UnitKind): number {
  switch (kind) {
    case 'worker': return 0;
    case 'defender': return 1;
    case 'raider': return 2;
  }
}

function workerPhaseToInt(phase: WorkerPhase): number {
  switch (phase) {
    case 'idle': return 0;
    case 'movingToNode': return 1;
    case 'harvesting': return 2;
    case 'returning': return 3;
  }
}
