// Per-tick lockstep orchestration with input delay.
//
// Phase 2.2 introduces the standard lockstep input-delay model: a
// command produced locally at tick T is not applied at tick T. It is
// broadcast to the peer tagged for tick T+D, and the sim consumes it
// at T+D. By that time, the peer has had D ticks (D * TICK_MS = 300ms
// at the default 6) for the message to arrive. This is what hides
// network round-trip from the player — input feels delayed by D ticks
// instead of "stalls when packets are late."
//
// The first D ticks have no real commands available (nothing has been
// produced yet). Both peers pre-seed empty frames for ticks 0..D-1 so
// the lockstep loop has something to consume during the warm-up. From
// tick D onward, the input pipeline is steady-state.
//
// This module is sim-pure: no DOM, no Three.js. The driver wiring in
// main.ts and the deterministic two-sim gate in lockstep-loop.test.ts
// both build on top of it.

import type { Command } from '../sim/commands';
import type { Match } from '../sim/replay';
import type { SimState } from '../sim/types';
import type { LockstepChannel } from './lockstep-channel';

// Default 6 ticks at 20 Hz = 300 ms. The investigation doc keeps this
// adjustable in alpha — some genres feel ok up to 10 frames, others
// crack at 4. Exposed as a constant rather than a magic number so a
// future tuning pass has a single source of truth.
export const INPUT_DELAY_TICKS = 6;

export interface LockstepLoopOptions {
  channel: LockstepChannel;
  // How many ticks of input delay between command production and
  // application. Default INPUT_DELAY_TICKS; a test can pass 0 to make
  // the loop equivalent to the un-delayed 2.0/2.1 path.
  inputDelay?: number;
  // Called once per source tick to gather the local faction's commands
  // for that tick. Keep it side-effect-free where possible — the
  // commands are scheduled for tick + D, so any state read here is
  // D ticks stale by the time it lands.
  collectLocalCommands(state: SimState, sourceTick: number): Command[];
}

export class LockstepLoop {
  readonly inputDelay: number;
  private readonly channel: LockstepChannel;
  private readonly collect: (state: SimState, sourceTick: number) => Command[];
  private preseeded = false;

  constructor(opts: LockstepLoopOptions) {
    this.channel = opts.channel;
    this.inputDelay = opts.inputDelay ?? INPUT_DELAY_TICKS;
    this.collect = opts.collectLocalCommands;
  }

  // Driver hook: the sim driver calls this in place of its old
  // commandsForTick callback. Returns the merged commands for the
  // current sim tick T, or null to stall.
  //
  // Sequencing per tick T:
  //   1. (Once at startup) submit empty frames for ticks 0..D-1.
  //   2. Submit local commands for tick T+D, exactly once.
  //   3. Submit our hash for tick T-1, exactly once.
  //   4. Try to consume merged commands for tick T. Null = stall.
  next(match: Match): Command[] | null {
    if (!this.channel.peerConnected) return null;

    if (!this.preseeded) {
      // Cross-peer pre-seed race: whichever peer's `next()` runs first
      // submits its empty frames for 0..D-1, but the other peer hasn't
      // submitted yet, so this peer's `tryConsumeOrderedFrame(0)` will
      // return null. Real drivers retry on the next rAF and the second
      // peer's pre-seed has landed by then. Tests using a synchronous
      // paired channel must mirror that retry — see lockstep-loop.test.ts
      // for the pattern. This isn't a bug; it's the same one-frame
      // stall every lockstep loop has at handshake.
      for (let t = 0; t < this.inputDelay; t++) {
        this.channel.submitLocalFrame(t, []);
      }
      this.preseeded = true;
    }

    const tick = match.tick;
    const scheduledTick = tick + this.inputDelay;

    if (!this.channel.hasSubmittedLocalFrame(scheduledTick)) {
      const cmds = this.collect(match.sim.state, tick);
      this.channel.submitLocalFrame(scheduledTick, cmds);
    }

    if (tick > 0 && !this.channel.hasSubmittedHash(tick - 1)) {
      this.channel.submitHash(tick - 1, match.sim.stateHash());
    }

    return this.channel.tryConsumeOrderedFrame(tick);
  }
}
