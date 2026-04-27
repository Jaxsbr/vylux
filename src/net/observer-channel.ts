// Receive-only sibling of LockstepChannel for the observer role
// (Phase 2.5).
//
// An observer doesn't have a local faction. It only consumes the two
// players' `frame` messages off the substrate, accumulates them by
// (tick, faction), and exposes a merged-frame consumer for the sim
// loop to drive the read-only sim with.
//
// Design rules carried forward from LockstepChannel:
//   - Same `frame` message shape — players don't have to know an
//     observer is listening. They just send to the channel as usual.
//   - Canonical merge order: faction 0 then faction 1, regardless of
//     arrival order. Same load-bearing rule from 2.0; an observer that
//     merged differently from the players would diverge by tick 1.
//   - Stable iteration: per-tick maps keyed by integer; consumed
//     entries pruned via forgetBefore() so memory stays bounded over
//     a long match.
//
// Substrate: any BroadcastChannelLike. For the 2.5 prototype the
// substrate is `BroadcastChannel('vylux-lockstep')` — three same-origin
// tabs on the same channel, the observer just listens. WebRTC observer
// (relayed through the signaling server) is flagged as a 2.5 follow-up
// in the investigation doc; same channel API, different transport.

import type { Command } from '../sim/commands';
import type { Faction } from '../sim/types';
import type { BroadcastChannelLike, LockstepMessage } from './lockstep-channel';

export interface ObserverChannelOptions {
  channel: BroadcastChannelLike;
}

export class ObserverChannel {
  private readonly channel: BroadcastChannelLike;
  private readonly frames: [Map<number, Command[]>, Map<number, Command[]>] = [
    new Map(),
    new Map(),
  ];
  private destroyed = false;
  private readonly listener = (ev: { data: LockstepMessage }) => this.handle(ev.data);

  constructor(opts: ObserverChannelOptions) {
    this.channel = opts.channel;
    this.channel.addEventListener('message', this.listener);
  }

  // True once at least one frame has arrived from each faction. This
  // is the observer's analogue of LockstepChannel.peerConnected — the
  // signal that "the players are talking; I have something to do."
  get bothFactionsSeen(): boolean {
    return this.frames[0].size > 0 && this.frames[1].size > 0;
  }

  // Returns the canonical merged commands for tick T (faction 0 first,
  // faction 1 second), or null if either faction's frame has not yet
  // arrived. Same semantics as LockstepChannel.tryConsumeOrderedFrame
  // — the observer's sim must apply commands in the same order as the
  // players, or its hash diverges immediately.
  tryConsumeMergedFrame(tick: number): Command[] | null {
    const f0 = this.frames[0].get(tick);
    const f1 = this.frames[1].get(tick);
    if (f0 === undefined || f1 === undefined) return null;
    return [...f0, ...f1];
  }

  // Discard frames older than `keepAfter`. Sim never looks backward,
  // so historical frames just hold memory. Called periodically by the
  // observer driver wiring.
  forgetBefore(keepAfter: number): void {
    pruneMap(this.frames[0], keepAfter);
    pruneMap(this.frames[1], keepAfter);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.channel.removeEventListener('message', this.listener);
    this.channel.close();
  }

  private handle(msg: LockstepMessage): void {
    if (this.destroyed) return;
    if (msg.kind !== 'frame') return; // hello + hash are player-only chatter
    if (msg.faction !== 0 && msg.faction !== 1) return;
    const map = this.frames[msg.faction as Faction];
    // First-write-wins. A repeat is either a player retransmit (we
    // shouldn't see any in the current substrate) or — once mid-match
    // attach is wired up in 2.5's follow-up — a re-broadcast on
    // observer join. Either way the canonical commands for tick T
    // are the first ones to land.
    if (!map.has(msg.tick)) {
      map.set(msg.tick, msg.commands);
    }
  }
}

function pruneMap<K extends number, V>(map: Map<K, V>, keepAfter: number): void {
  for (const k of map.keys()) {
    if (k < keepAfter) map.delete(k);
  }
}
