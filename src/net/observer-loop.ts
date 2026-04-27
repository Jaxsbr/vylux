// Per-tick orchestration for the observer role (Phase 2.5).
//
// Mirrors the shape of LockstepLoop but strips out everything an
// observer doesn't do: no local commands, no scheduled-frame submit,
// no input delay, no hash exchange. The observer just waits for both
// players' frames for tick T to arrive on the ObserverChannel and
// returns them merged so the driver can step the sim.
//
// Why no input delay? The frames coming off the channel were already
// scheduled with the input-delay offset by the players. Frame
// `{ tick: T }` from a player means "the merged input that should be
// applied at sim tick T". The observer applies it at its own sim tick
// T directly. No further offset.

import type { Command } from '../sim/commands';
import type { Match } from '../sim/replay';
import type { ObserverChannel } from './observer-channel';

export interface ObserverLoopOptions {
  channel: ObserverChannel;
}

export class ObserverLoop {
  private readonly channel: ObserverChannel;

  constructor(opts: ObserverLoopOptions) {
    this.channel = opts.channel;
  }

  // Driver hook — same shape as the lockstep callback. Returns the
  // merged commands for the current sim tick or null to stall.
  next(match: Match): Command[] | null {
    if (!this.channel.bothFactionsSeen) return null;
    return this.channel.tryConsumeMergedFrame(match.tick);
  }
}
