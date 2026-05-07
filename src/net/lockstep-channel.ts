// Two-tab lockstep transport over BroadcastChannel.
//
// Phase 2.0 — proves the lockstep model on a single machine before any
// real network is involved. Two browser tabs each instantiate a
// LockstepChannel; one is faction 0 (the "host" role), the other is
// faction 1 (the "join" role). They exchange three message kinds:
//
//   - hello: announces presence + which faction this tab owns.
//   - frame: this tab's commands for tick T.
//   - hash:  this tab's stateHash() for tick T (for cross-tab desync
//            detection — the production analogue of Phase 0's in-process
//            hash gate, applied across "two clients" via the channel).
//
// The transport is intentionally tiny — no reliability layer, no
// reordering tolerance beyond simple per-tick keying. BroadcastChannel
// is in-process delivery; messages don't drop, but they are async (next
// task / microtask boundary). The lockstep loop in the driver naturally
// stalls one rAF if the peer's frame hasn't arrived yet.
//
// Phase 2.1 onward replaces this with WebRTC; the message shapes and
// the channel API stay the same so the driver wiring doesn't shift.

import type { Command } from '../sim/commands';
import type { Faction } from '../sim/types';

export type LockstepMessage =
  | { kind: 'hello'; faction: Faction }
  | { kind: 'frame'; tick: number; faction: Faction; commands: Command[] }
  | { kind: 'hash'; tick: number; faction: Faction; hash: string };

// Minimal BroadcastChannel surface so we can substitute a paired fake in
// unit tests without pulling in a DOM environment.
export interface BroadcastChannelLike {
  postMessage(data: LockstepMessage): void;
  addEventListener(type: 'message', listener: (ev: { data: LockstepMessage }) => void): void;
  removeEventListener(type: 'message', listener: (ev: { data: LockstepMessage }) => void): void;
  close(): void;
}

export interface DesyncReport {
  tick: number;
  localHash: string;
  remoteHash: string;
}

export interface LockstepChannelOptions {
  channel: BroadcastChannelLike;
  localFaction: Faction;
  onDesync?(report: DesyncReport): void;
  onPeerHello?(faction: Faction): void;
}

export class LockstepChannel {
  readonly localFaction: Faction;
  readonly remoteFaction: Faction;

  private readonly channel: BroadcastChannelLike;
  private readonly localFrames = new Map<number, Command[]>();
  private readonly remoteFrames = new Map<number, Command[]>();
  private readonly localHashes = new Map<number, string>();
  private readonly remoteHashes = new Map<number, string>();
  private readonly desyncedTicks = new Set<number>();

  private peerSeen = false;
  private destroyed = false;

  private readonly onDesync?: (report: DesyncReport) => void;
  private readonly onPeerHello?: (faction: Faction) => void;
  private readonly listener = (ev: { data: LockstepMessage }) => this.handle(ev.data);

  constructor(opts: LockstepChannelOptions) {
    this.channel = opts.channel;
    this.localFaction = opts.localFaction;
    this.remoteFaction = (1 - opts.localFaction) as Faction;
    this.onDesync = opts.onDesync;
    this.onPeerHello = opts.onPeerHello;
    this.channel.addEventListener('message', this.listener);
  }

  // Announce ourselves and declare which faction this tab owns. Idempotent
  // — safe to call repeatedly; the peer just re-confirms presence.
  sendHello(): void {
    this.channel.postMessage({ kind: 'hello', faction: this.localFaction });
  }

  get peerConnected(): boolean {
    return this.peerSeen;
  }

  hasSubmittedLocalFrame(tick: number): boolean {
    return this.localFrames.has(tick);
  }

  // Submits the local faction's commands for tick T and broadcasts them
  // to the peer. Calling twice for the same tick is an error — the
  // sim is the authority for "what tick we're on" and there should only
  // ever be one local frame per tick.
  submitLocalFrame(tick: number, commands: Command[]): void {
    if (this.localFrames.has(tick)) {
      throw new Error(`LockstepChannel: duplicate local frame for tick ${tick}`);
    }
    const frozen = commands.slice();
    this.localFrames.set(tick, frozen);
    this.channel.postMessage({
      kind: 'frame',
      tick,
      faction: this.localFaction,
      commands: frozen,
    });
  }

  // Returns both factions' commands for tick T as two arrays, or null if
  // either side hasn't been submitted/received yet. Useful for tests +
  // HUD inspection; the driver should use tryConsumeOrderedFrame to get
  // the canonical command order.
  tryConsumeFrame(tick: number): { local: Command[]; remote: Command[] } | null {
    const local = this.localFrames.get(tick);
    const remote = this.remoteFrames.get(tick);
    if (local === undefined || remote === undefined) return null;
    return { local, remote };
  }

  // Returns the merged commands for tick T in canonical order: faction-0
  // commands first, faction-1 commands second. Both peers see the same
  // ordering, which is load-bearing for determinism — the sim applies
  // commands in given order and TrainUnit allocates entity IDs per
  // apply, so a different merge order would produce a different state.
  tryConsumeOrderedFrame(tick: number): Command[] | null {
    const local = this.localFrames.get(tick);
    const remote = this.remoteFrames.get(tick);
    if (local === undefined || remote === undefined) return null;
    return this.localFaction === 0 ? [...local, ...remote] : [...remote, ...local];
  }

  hasSubmittedHash(tick: number): boolean {
    return this.localHashes.has(tick);
  }

  // Submits the local stateHash() for tick T and broadcasts it. Compared
  // against the peer's hash on arrival; first mismatch fires onDesync.
  submitHash(tick: number, hash: string): void {
    if (this.localHashes.has(tick)) return;
    this.localHashes.set(tick, hash);
    this.channel.postMessage({ kind: 'hash', tick, faction: this.localFaction, hash });
    this.compareHash(tick);
  }

  // Visibility for tests + HUD. 'pending' = either side hasn't reported
  // yet. 'match' / 'desync' are both terminal for this tick.
  hashStatus(tick: number): 'pending' | 'match' | 'desync' {
    const local = this.localHashes.get(tick);
    const remote = this.remoteHashes.get(tick);
    if (local === undefined || remote === undefined) return 'pending';
    return local === remote ? 'match' : 'desync';
  }

  // Highest tick T where both sides have submitted a hash. Returned
  // status ('match' or 'desync') is terminal for that tick. The HUD
  // uses this to show a stable view of cross-tab agreement that
  // doesn't flicker as messages cross the channel async.
  latestResolvedHash(): { tick: number; status: 'match' | 'desync' } | null {
    let best = -1;
    for (const t of this.localHashes.keys()) {
      if (t > best && this.remoteHashes.has(t)) best = t;
    }
    if (best < 0) return null;
    const status = this.hashStatus(best);
    if (status === 'pending') return null;
    return { tick: best, status };
  }

  // Discard frames + hashes older than `keepAfter`. The sim never looks
  // backward, so historical frames just hold memory. Called periodically
  // by the driver wiring.
  forgetBefore(keepAfter: number): void {
    pruneMap(this.localFrames, keepAfter);
    pruneMap(this.remoteFrames, keepAfter);
    pruneMap(this.localHashes, keepAfter);
    pruneMap(this.remoteHashes, keepAfter);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.channel.removeEventListener('message', this.listener);
    this.channel.close();
  }

  private handle(msg: LockstepMessage): void {
    if (this.destroyed) return;
    switch (msg.kind) {
      case 'hello':
        if (msg.faction === this.localFaction) return; // our own echo
        if (!this.peerSeen) {
          this.peerSeen = true;
          this.onPeerHello?.(msg.faction);
          // Re-announce so a peer that joined late still hears us.
          this.sendHello();
        }
        return;

      case 'frame':
        if (msg.faction === this.localFaction) return; // our own echo
        // Late or duplicate frames are dropped — once a tick has been
        // consumed and stepped, the sim has moved on and the bytes are
        // useless. First-write-wins.
        if (!this.remoteFrames.has(msg.tick)) {
          this.remoteFrames.set(msg.tick, msg.commands);
        }
        return;

      case 'hash':
        if (msg.faction === this.localFaction) return;
        if (!this.remoteHashes.has(msg.tick)) {
          this.remoteHashes.set(msg.tick, msg.hash);
          this.compareHash(msg.tick);
        }
        return;
    }
  }

  private compareHash(tick: number): void {
    if (this.desyncedTicks.has(tick)) return;
    const local = this.localHashes.get(tick);
    const remote = this.remoteHashes.get(tick);
    if (local === undefined || remote === undefined) return;
    if (local !== remote) {
      this.desyncedTicks.add(tick);
      this.onDesync?.({ tick, localHash: local, remoteHash: remote });
    }
  }
}

function pruneMap<K extends number, V>(map: Map<K, V>, keepAfter: number): void {
  for (const k of map.keys()) {
    if (k < keepAfter) map.delete(k);
  }
}
