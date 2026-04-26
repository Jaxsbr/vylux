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
import type { SimState } from './types';

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

    // Factions — fixed length 2, fixed field order.
    for (let f = 0; f < 2; f++) {
      const fs = s.factions[f];
      h.writeI32(fs.hqX);
      h.writeI32(fs.hqY);
      h.writeI32(fs.energy);
    }

    // Workers — array order is the sim's iteration order, dead workers
    // included so removed entries don't shift live indices.
    h.writeU32(s.workers.length);
    for (let i = 0; i < s.workers.length; i++) {
      const w = s.workers[i];
      h.writeU32(w.id);
      h.writeU32(w.alive ? 1 : 0);
      h.writeU32(w.faction);
      h.writeI32(w.x);
      h.writeI32(w.y);
      h.writeU32(workerPhaseToInt(w.phase));
      h.writeU32(w.targetNodeId);
      h.writeI32(w.carrying);
      h.writeU32(w.harvestTicksRemaining);
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

function workerPhaseToInt(phase: SimState['workers'][number]['phase']): number {
  switch (phase) {
    case 'idle': return 0;
    case 'movingToNode': return 1;
    case 'harvesting': return 2;
    case 'returning': return 3;
  }
}
