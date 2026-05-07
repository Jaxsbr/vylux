// Lockstep channel tests + the Phase 2.0 "two-sim same-state" gate.
//
// The gate is the load-bearing check for sub-phase 2.0: drive two
// Match instances against paired LockstepChannels, exchange tick frames
// over a fake BroadcastChannel, step both sims to a final state, and
// verify per-tick hashes agree on every tick. This is the cheapest
// determinism check across "two clients" before any real network is
// added in 2.1+.

import { describe, expect, it } from 'vitest';
import { CommandKind, type Command } from '../sim/commands';
import { Match } from '../sim/replay';
import { tickAi } from '../sim/ai';
import type { InitialMatchSpec } from '../sim/state';
import { LockstepChannel, type BroadcastChannelLike, type LockstepMessage } from './lockstep-channel';

// Paired in-process BroadcastChannel substitute. Messages from one end
// arrive on the other (and itself, mimicking real BroadcastChannel
// behaviour where the local listener receives its own posts; the
// LockstepChannel filters self-faction echoes by faction id).
class PairedChannel implements BroadcastChannelLike {
  private readonly listeners = new Set<(ev: { data: LockstepMessage }) => void>();
  private peer: PairedChannel | null = null;
  private closed = false;
  private readonly inbox: LockstepMessage[] = [];

  static pair(): [PairedChannel, PairedChannel] {
    const a = new PairedChannel();
    const b = new PairedChannel();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  postMessage(data: LockstepMessage): void {
    if (this.closed) return;
    // Real BroadcastChannel does NOT echo to the same instance, only
    // to other instances on the same name. We forward only to the peer.
    this.peer?.deliver(data);
  }

  // Delivery is synchronous for the unit tests so the gate is
  // deterministic. Production transport is async (microtask boundary)
  // and the lockstep loop handles that via the driver-level "wait" path.
  private deliver(msg: LockstepMessage): void {
    if (this.closed) return;
    this.inbox.push(msg);
    for (const l of this.listeners) l({ data: msg });
  }

  addEventListener(_type: 'message', listener: (ev: { data: LockstepMessage }) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (ev: { data: LockstepMessage }) => void): void {
    this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }

  get inboxSize(): number { return this.inbox.length; }
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

describe('LockstepChannel — protocol', () => {
  it('hello handshake establishes peer presence on both sides via auto-echo', () => {
    // The receiver re-broadcasts hello on first peer-hello receipt, so a
    // single sendHello from one side is enough to mutually establish
    // connection. This handles late-join: whichever tab opens second
    // doesn't need to know the first tab is already there.
    const [a, b] = PairedChannel.pair();
    const helloA: number[] = [];
    const helloB: number[] = [];
    const left = new LockstepChannel({
      channel: a, localFaction: 0,
      onPeerHello: (f) => helloA.push(f),
    });
    const right = new LockstepChannel({
      channel: b, localFaction: 1,
      onPeerHello: (f) => helloB.push(f),
    });

    left.sendHello();
    expect(left.peerConnected).toBe(true);
    expect(right.peerConnected).toBe(true);
    expect(helloA).toEqual([1]);
    expect(helloB).toEqual([0]);

    left.destroy();
    right.destroy();
  });

  it('frame submit + consume returns merged commands once both sides arrive', () => {
    const [a, b] = PairedChannel.pair();
    const left = new LockstepChannel({ channel: a, localFaction: 0 });
    const right = new LockstepChannel({ channel: b, localFaction: 1 });

    expect(left.tryConsumeFrame(0)).toBeNull();

    const cmd0: Command = { kind: CommandKind.TrainUnit, faction: 0, unitKind: 'worker' };
    left.submitLocalFrame(0, [cmd0]);
    expect(left.tryConsumeFrame(0)).toBeNull(); // remote side hasn't sent yet
    expect(right.tryConsumeFrame(0)).toBeNull(); // right hasn't submitted its own

    const cmd1: Command = { kind: CommandKind.TrainUnit, faction: 1, unitKind: 'raider' };
    right.submitLocalFrame(0, [cmd1]);

    const fromLeft = left.tryConsumeFrame(0);
    const fromRight = right.tryConsumeFrame(0);
    expect(fromLeft).not.toBeNull();
    expect(fromRight).not.toBeNull();
    expect(fromLeft!.local).toEqual([cmd0]);
    expect(fromLeft!.remote).toEqual([cmd1]);
    expect(fromRight!.local).toEqual([cmd1]);
    expect(fromRight!.remote).toEqual([cmd0]);

    left.destroy();
    right.destroy();
  });

  it('hash compare reports match / desync correctly', () => {
    const [a, b] = PairedChannel.pair();
    const desyncs: { side: string; tick: number }[] = [];
    const left = new LockstepChannel({
      channel: a, localFaction: 0,
      onDesync: (r) => desyncs.push({ side: 'left', tick: r.tick }),
    });
    const right = new LockstepChannel({
      channel: b, localFaction: 1,
      onDesync: (r) => desyncs.push({ side: 'right', tick: r.tick }),
    });

    left.submitHash(0, 'abc');
    right.submitHash(0, 'abc');
    expect(left.hashStatus(0)).toBe('match');
    expect(right.hashStatus(0)).toBe('match');
    expect(desyncs).toEqual([]);

    left.submitHash(1, 'def');
    right.submitHash(1, 'xyz');
    expect(left.hashStatus(1)).toBe('desync');
    expect(right.hashStatus(1)).toBe('desync');
    expect(desyncs.map((d) => d.side).sort()).toEqual(['left', 'right']);
    expect(desyncs.every((d) => d.tick === 1)).toBe(true);

    left.destroy();
    right.destroy();
  });

  it('forgetBefore prunes stale frames + hashes', () => {
    const [a, b] = PairedChannel.pair();
    const left = new LockstepChannel({ channel: a, localFaction: 0 });
    const right = new LockstepChannel({ channel: b, localFaction: 1 });

    left.submitLocalFrame(0, []);
    right.submitLocalFrame(0, []);
    left.submitLocalFrame(1, []);
    right.submitLocalFrame(1, []);
    left.submitHash(0, 'h0');

    left.forgetBefore(1);
    expect(left.hasSubmittedLocalFrame(0)).toBe(false);
    expect(left.hasSubmittedLocalFrame(1)).toBe(true);
    expect(left.tryConsumeFrame(0)).toBeNull();
    expect(left.tryConsumeFrame(1)).not.toBeNull();
    expect(left.hashStatus(0)).toBe('pending'); // both sides cleared

    left.destroy();
    right.destroy();
  });

  it('rejects duplicate local-frame submission for the same tick', () => {
    const [a, b] = PairedChannel.pair();
    const left = new LockstepChannel({ channel: a, localFaction: 0 });
    const right = new LockstepChannel({ channel: b, localFaction: 1 });

    left.submitLocalFrame(0, []);
    expect(() => left.submitLocalFrame(0, [])).toThrow(/duplicate local frame/);

    left.destroy();
    right.destroy();
  });
});

describe('LockstepChannel — Phase 2.0 two-sim same-state gate', () => {
  // Drive two Match instances over paired channels for a long match.
  // Each "tab" is one faction; faction 0 plays its AI's commands,
  // faction 1 plays its AI's commands. They both run the merged input
  // stream every tick. Per-tick hashes must agree on every tick.
  it('two paired sims reach identical per-tick hashes for 600 ticks of AI play', () => {
    const [chA, chB] = PairedChannel.pair();
    const left = new LockstepChannel({ channel: chA, localFaction: 0 });
    const right = new LockstepChannel({ channel: chB, localFaction: 1 });
    left.sendHello();
    right.sendHello();
    expect(left.peerConnected).toBe(true);
    expect(right.peerConnected).toBe(true);

    const matchL = new Match(SPEC);
    const matchR = new Match(SPEC);
    const initialHashL = matchL.sim.stateHash();
    const initialHashR = matchR.sim.stateHash();
    expect(initialHashL).toBe(initialHashR);

    const MAX_TICKS = 600;
    for (let t = 0; t < MAX_TICKS; t++) {
      // Each side computes its own faction's commands. The merged input
      // is the union of both sides' commands.
      const cmdsL = tickAi(matchL.sim.state, 0);
      const cmdsR = tickAi(matchR.sim.state, 1);
      left.submitLocalFrame(t, cmdsL);
      right.submitLocalFrame(t, cmdsR);

      const mergedL = left.tryConsumeOrderedFrame(t);
      const mergedR = right.tryConsumeOrderedFrame(t);
      expect(mergedL).not.toBeNull();
      expect(mergedR).not.toBeNull();
      // Both peers see the same canonical command order — load-bearing
      // for determinism because TrainUnit assigns entity IDs in apply
      // order. If this regresses, hashes will diverge by tick 1 of any
      // tick where both factions queue a command.
      expect(mergedL).toEqual(mergedR);

      const finishedL = matchL.step(mergedL!);
      const finishedR = matchR.step(mergedR!);

      const hL = matchL.sim.stateHash();
      const hR = matchR.sim.stateHash();
      left.submitHash(t, hL);
      right.submitHash(t, hR);

      expect(hL).toBe(hR);
      expect(left.hashStatus(t)).toBe('match');
      expect(right.hashStatus(t)).toBe('match');
      expect(finishedL).toBe(finishedR);

      if (finishedL) break;
    }

    expect(matchL.tick).toBe(matchR.tick);
    expect(matchL.winner).toBe(matchR.winner);
    expect(matchL.sim.stateHash()).toBe(matchR.sim.stateHash());

    left.destroy();
    right.destroy();
  });
});
