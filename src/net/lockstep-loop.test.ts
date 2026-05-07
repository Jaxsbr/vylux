// Phase 2.2 input-delay gate.
//
// Drives two paired Match instances through LockstepLoop with the
// production input delay (6 ticks). Both peers pre-seed empty frames
// for the warm-up window, schedule their own faction's commands for
// tick T+D, and consume the merged frame at tick T. Per-tick hashes
// must agree on every tick — the gate is unchanged from 2.0/2.1; the
// only thing that moved is when the commands take effect.

import { describe, expect, it } from 'vitest';
import { tickAi } from '../sim/ai';
import type { Command } from '../sim/commands';
import { Match } from '../sim/replay';
import type { InitialMatchSpec } from '../sim/state';
import type { Faction, SimState } from '../sim/types';
import {
  LockstepChannel,
  type BroadcastChannelLike,
  type LockstepMessage,
} from './lockstep-channel';
import { LockstepLoop, INPUT_DELAY_TICKS } from './lockstep-loop';

class PairedChannel implements BroadcastChannelLike {
  private readonly listeners = new Set<(ev: { data: LockstepMessage }) => void>();
  private peer: PairedChannel | null = null;
  private closed = false;

  static pair(): [PairedChannel, PairedChannel] {
    const a = new PairedChannel();
    const b = new PairedChannel();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  postMessage(data: LockstepMessage): void {
    if (this.closed) return;
    this.peer?.deliver(data);
  }
  private deliver(msg: LockstepMessage): void {
    if (this.closed) return;
    for (const l of this.listeners) l({ data: msg });
  }
  addEventListener(_t: 'message', l: (ev: { data: LockstepMessage }) => void): void { this.listeners.add(l); }
  removeEventListener(_t: 'message', l: (ev: { data: LockstepMessage }) => void): void { this.listeners.delete(l); }
  close(): void { this.closed = true; this.listeners.clear(); }
}

const SPEC: InitialMatchSpec = {
  seed: 42,
  hqs: { faction0: { x: 3, y: 3 }, faction1: { x: 16, y: 16 } },
  nodes: [
    { x: 6, y: 6, energy: 200 },
    { x: 13, y: 13, energy: 200 },
    { x: 10, y: 10, energy: 200 },
    { x: 6, y: 13, energy: 200 },
    { x: 13, y: 6, energy: 200 },
  ],
  initialEnergy: 200,
  hqMaxHp: 250,
};

function runPairedLoop(inputDelay: number, maxTicks: number): {
  finalHashL: string;
  finalHashR: string;
  finalTickL: number;
  finalTickR: number;
} {
  const [chA, chB] = PairedChannel.pair();
  const left = new LockstepChannel({ channel: chA, localFaction: 0 });
  const right = new LockstepChannel({ channel: chB, localFaction: 1 });
  left.sendHello();
  right.sendHello();

  const matchL = new Match(SPEC);
  const matchR = new Match(SPEC);

  const collectFor = (faction: Faction) => (state: SimState, _sourceTick: number): Command[] =>
    tickAi(state, faction);

  const loopL = new LockstepLoop({ channel: left, inputDelay, collectLocalCommands: collectFor(0) });
  const loopR = new LockstepLoop({ channel: right, inputDelay, collectLocalCommands: collectFor(1) });

  for (let i = 0; i < maxTicks; i++) {
    // Real drivers retry next-rAF on a stall. Mirror that: at startup
    // the first peer's call lands before the second has pre-seeded, so
    // one or the other returns null on the first attempt. Iteration 0
    // costs at most one retry; from there it's always non-null.
    let cmdsL = loopL.next(matchL);
    let cmdsR = loopR.next(matchR);
    let retries = 5;
    while ((cmdsL === null || cmdsR === null) && retries-- > 0) {
      cmdsL = cmdsL ?? loopL.next(matchL);
      cmdsR = cmdsR ?? loopR.next(matchR);
    }
    expect(cmdsL).not.toBeNull();
    expect(cmdsR).not.toBeNull();
    // Both peers consume the same canonical merged frame for the tick
    // — the gate property of 2.0 carries forward unchanged.
    expect(cmdsL).toEqual(cmdsR);

    matchL.step(cmdsL!);
    matchR.step(cmdsR!);
    expect(matchL.sim.stateHash()).toBe(matchR.sim.stateHash());
    if (matchL.winner !== null) break;
  }

  return {
    finalHashL: matchL.sim.stateHash(),
    finalHashR: matchR.sim.stateHash(),
    finalTickL: matchL.tick,
    finalTickR: matchR.tick,
  };
}

describe('LockstepLoop — input delay', () => {
  it('default INPUT_DELAY_TICKS is 6 (300ms at 20Hz)', () => {
    expect(INPUT_DELAY_TICKS).toBe(6);
  });

  it('pre-seeds D empty frames at startup so the warm-up ticks have something to consume', () => {
    const [chA, chB] = PairedChannel.pair();
    const left = new LockstepChannel({ channel: chA, localFaction: 0 });
    const right = new LockstepChannel({ channel: chB, localFaction: 1 });
    left.sendHello();
    right.sendHello();

    const match = new Match(SPEC);
    const loop = new LockstepLoop({
      channel: left,
      inputDelay: 6,
      collectLocalCommands: () => [],
    });

    // Without the right peer's pre-seed, the consume should still
    // stall — left has its own pre-seeded frames but remote ones are
    // missing.
    expect(loop.next(match)).toBeNull();

    const rightLoop = new LockstepLoop({
      channel: right,
      inputDelay: 6,
      collectLocalCommands: () => [],
    });
    rightLoop.next(match); // triggers right's pre-seed broadcast

    // Now both sides have pre-seeded ticks 0..5 with empty frames.
    const cmds = loop.next(match);
    expect(cmds).not.toBeNull();
    expect(cmds).toEqual([]); // empty merged frame for tick 0
  });

  it('two paired sims at D=6 reach identical per-tick hashes for 600 ticks', () => {
    const result = runPairedLoop(6, 600);
    expect(result.finalHashL).toBe(result.finalHashR);
    expect(result.finalTickL).toBe(result.finalTickR);
  });

  it('D=0 (un-delayed mode used by 2.0 gate) still works through the loop helper', () => {
    const result = runPairedLoop(0, 200);
    expect(result.finalHashL).toBe(result.finalHashR);
    expect(result.finalTickL).toBe(result.finalTickR);
  });

  it('returns null while peer has not handshaked', () => {
    const [chA, chB] = PairedChannel.pair();
    const left = new LockstepChannel({ channel: chA, localFaction: 0 });
    void chB; // unused for this case — we want no peer hello
    const match = new Match(SPEC);
    const loop = new LockstepLoop({
      channel: left,
      inputDelay: 6,
      collectLocalCommands: () => [],
    });
    expect(loop.next(match)).toBeNull();
  });
});
