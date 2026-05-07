// Phase 2.5 three-sim gate.
//
// Drives THREE Match instances over a shared channel:
//   - host  (faction 0, full LockstepLoop with input delay 6)
//   - join  (faction 1, full LockstepLoop with input delay 6)
//   - observer (no faction, ObserverLoop)
//
// All three must agree on per-tick hashes throughout. Same property
// the 2.0 / 2.2 gates assert across two sims; here we add the third
// sim and verify the observer reaches the same state from frames it
// only listened to.

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
import { LockstepLoop } from './lockstep-loop';
import { ObserverChannel } from './observer-channel';
import { ObserverLoop } from './observer-loop';

// Multi-port channel that fans messages from any endpoint out to all
// other endpoints — same shape every browser tab on a real
// BroadcastChannel('vylux-lockstep') would see. The constructor
// returns N endpoints; each endpoint is a BroadcastChannelLike that
// delivers postMessage to the other (N-1) endpoints synchronously.
class FanOutChannel {
  private readonly endpoints: Endpoint[] = [];

  static create(n: number): BroadcastChannelLike[] {
    const fan = new FanOutChannel();
    const eps: BroadcastChannelLike[] = [];
    for (let i = 0; i < n; i++) {
      const ep = new Endpoint(fan);
      fan.endpoints.push(ep);
      eps.push(ep);
    }
    return eps;
  }

  deliver(from: Endpoint, msg: LockstepMessage): void {
    for (const ep of this.endpoints) {
      if (ep === from) continue; // BroadcastChannel does not echo
      ep.receive(msg);
    }
  }
}

class Endpoint implements BroadcastChannelLike {
  private readonly listeners = new Set<(ev: { data: LockstepMessage }) => void>();
  private closed = false;
  constructor(private readonly fan: FanOutChannel) {}

  postMessage(data: LockstepMessage): void {
    if (this.closed) return;
    this.fan.deliver(this, data);
  }
  receive(msg: LockstepMessage): void {
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

describe('ObserverChannel — three-sim same-state gate', () => {
  it('observer reaches identical per-tick hashes to host + join for 600 ticks', () => {
    const [hostEp, joinEp, obsEp] = FanOutChannel.create(3);

    const hostChan = new LockstepChannel({ channel: hostEp, localFaction: 0 });
    const joinChan = new LockstepChannel({ channel: joinEp, localFaction: 1 });
    const obsChan = new ObserverChannel({ channel: obsEp });
    hostChan.sendHello();
    joinChan.sendHello();

    const hostMatch = new Match(SPEC);
    const joinMatch = new Match(SPEC);
    const obsMatch = new Match(SPEC);

    const collectFor = (faction: Faction) => (state: SimState): Command[] =>
      tickAi(state, faction);

    const hostLoop = new LockstepLoop({ channel: hostChan, inputDelay: 6, collectLocalCommands: collectFor(0) });
    const joinLoop = new LockstepLoop({ channel: joinChan, inputDelay: 6, collectLocalCommands: collectFor(1) });
    const obsLoop = new ObserverLoop({ channel: obsChan });

    const MAX_TICKS = 600;
    for (let i = 0; i < MAX_TICKS; i++) {
      // Same retry pattern as LockstepLoop tests — handles the
      // synchronous-fanout pre-seed crossover at iteration 0.
      let hostCmds = hostLoop.next(hostMatch);
      let joinCmds = joinLoop.next(joinMatch);
      let obsCmds = obsLoop.next(obsMatch);
      let retries = 5;
      while ((hostCmds === null || joinCmds === null || obsCmds === null) && retries-- > 0) {
        hostCmds = hostCmds ?? hostLoop.next(hostMatch);
        joinCmds = joinCmds ?? joinLoop.next(joinMatch);
        obsCmds = obsCmds ?? obsLoop.next(obsMatch);
      }
      expect(hostCmds).not.toBeNull();
      expect(joinCmds).not.toBeNull();
      expect(obsCmds).not.toBeNull();
      // The observer's merged frame must match what the players see.
      // If a player ever got a different command stream than the
      // observer for the same tick, their hashes would diverge.
      expect(obsCmds).toEqual(hostCmds);
      expect(obsCmds).toEqual(joinCmds);

      hostMatch.step(hostCmds!);
      joinMatch.step(joinCmds!);
      obsMatch.step(obsCmds!);

      const h = hostMatch.sim.stateHash();
      expect(joinMatch.sim.stateHash()).toBe(h);
      expect(obsMatch.sim.stateHash()).toBe(h);

      if (hostMatch.winner !== null) break;
    }

    expect(obsMatch.tick).toBe(hostMatch.tick);
    expect(obsMatch.winner).toBe(hostMatch.winner);
  });

  it('bothFactionsSeen is false until at least one frame from each faction has landed', () => {
    const [aEp, bEp, obsEp] = FanOutChannel.create(3);
    const aChan = new LockstepChannel({ channel: aEp, localFaction: 0 });
    const bChan = new LockstepChannel({ channel: bEp, localFaction: 1 });
    const obs = new ObserverChannel({ channel: obsEp });

    expect(obs.bothFactionsSeen).toBe(false);

    aChan.submitLocalFrame(0, []);
    expect(obs.bothFactionsSeen).toBe(false);

    bChan.submitLocalFrame(0, []);
    expect(obs.bothFactionsSeen).toBe(true);
  });

  it('forgetBefore prunes consumed frames from both faction maps', () => {
    const [aEp, bEp, obsEp] = FanOutChannel.create(3);
    const aChan = new LockstepChannel({ channel: aEp, localFaction: 0 });
    const bChan = new LockstepChannel({ channel: bEp, localFaction: 1 });
    const obs = new ObserverChannel({ channel: obsEp });

    aChan.submitLocalFrame(0, []);
    aChan.submitLocalFrame(1, []);
    bChan.submitLocalFrame(0, []);
    bChan.submitLocalFrame(1, []);
    expect(obs.tryConsumeMergedFrame(0)).not.toBeNull();
    expect(obs.tryConsumeMergedFrame(1)).not.toBeNull();

    obs.forgetBefore(1);
    expect(obs.tryConsumeMergedFrame(0)).toBeNull();
    expect(obs.tryConsumeMergedFrame(1)).not.toBeNull();
  });

  it('observer ignores hello + hash messages — only frames drive its sim', () => {
    const [aEp, obsEp] = FanOutChannel.create(2);
    const obs = new ObserverChannel({ channel: obsEp });
    const aChan = new LockstepChannel({ channel: aEp, localFaction: 0 });

    aChan.sendHello();
    aChan.submitHash(0, 'abcd');
    expect(obs.bothFactionsSeen).toBe(false);
    expect(obs.tryConsumeMergedFrame(0)).toBeNull();

    aChan.submitLocalFrame(0, []);
    expect(obs.bothFactionsSeen).toBe(false); // only one faction so far
  });
});
