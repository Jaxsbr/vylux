// Fixed-tick sim driver coupled to a render frame loop.
//
// PRD §3.3: rendering is a read-only consumer of sim state. The sim
// ticks at a fixed rate (TICK_HZ); the renderer interpolates between
// sim states.
//
// Implementation: requestAnimationFrame for both. Each frame:
//   1. Catch up: while wall-clock has advanced past the next-due sim
//      tick, capturePrev() + step the sim. Capped at MAX_STEPS_PER_FRAME
//      so a paused tab doesn't trigger a "spiral of death" on resume.
//   2. Render: lerp using alpha = elapsedSinceLastTick / TICK_MS.
//
// The driver is sim-frontend-agnostic: it calls a `commandsForTick`
// callback to get input, so the same driver runs an AI-only match
// (callback returns AI commands), a player-vs-AI match (callback
// merges click-derived commands with AI commands), or a replay
// (callback returns the next recorded frame's commands).
//
// Lockstep wait protocol: `commandsForTick` may return `null`, which
// means "I'm not ready to step this tick yet — try again next frame."
// The driver leaves `nextTickTime` untouched and does NOT count this
// as a dropped step. This is how the lockstep transport (Phase 2.0+)
// stalls the loop until the opponent's frame for the current tick has
// arrived.

import type { Match } from '../sim/replay';
import type { Command } from '../sim/commands';
import type { SimRenderer } from './sim-renderer';
import type { SceneBundle } from './scene';

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
const MAX_STEPS_PER_FRAME = 5;

export type CommandsForTick = (match: Match) => Command[] | null;

export interface DriverHandle {
  stop(): void;
  // Read-only counters that the HUD can show.
  readonly ticks: number;
  readonly droppedSteps: number;
}

export function startSimDriver(
  match: Match,
  renderer: SimRenderer,
  scene: SceneBundle,
  commandsForTick: CommandsForTick,
): DriverHandle {
  let nextTickTime = performance.now();
  let stopped = false;
  let ticks = 0;
  let droppedSteps = 0;

  const handle: DriverHandle = {
    stop() {
      stopped = true;
    },
    get ticks() { return ticks; },
    get droppedSteps() { return droppedSteps; },
  };

  function frame(now: number): void {
    if (stopped) return;
    requestAnimationFrame(frame);

    // Catch up the sim. Cap steps per frame to bound work even after a
    // long pause (tab backgrounded, system sleep, etc.).
    let stepsThisFrame = 0;
    let stalled = false;
    while (now >= nextTickTime && stepsThisFrame < MAX_STEPS_PER_FRAME && match.winner === null) {
      renderer.capturePrev();
      const cmds = commandsForTick(match);
      if (cmds === null) {
        // Lockstep stall — peer frame hasn't arrived yet. Don't step,
        // don't advance the schedule, don't count as dropped. We'll
        // retry on the next animation frame.
        stalled = true;
        break;
      }
      match.step(cmds);
      nextTickTime += TICK_MS;
      stepsThisFrame++;
      ticks++;
    }
    // If we hit the cap (and weren't stalled waiting on input), discard
    // backlog so we don't spiral. Stalls don't count — the wait is
    // intentional and the schedule is paused.
    if (!stalled && stepsThisFrame === MAX_STEPS_PER_FRAME && now >= nextTickTime) {
      const dropped = Math.floor((now - nextTickTime) / TICK_MS) + 1;
      droppedSteps += dropped;
      nextTickTime = now + TICK_MS;
    }

    // Render with interpolation alpha.
    const sinceLast = now - (nextTickTime - TICK_MS);
    const alpha = match.winner !== null ? 1 : Math.max(0, Math.min(1, sinceLast / TICK_MS));
    renderer.update(alpha);
    scene.updateBackgroundParallax();
    scene.composer.render();
  }

  requestAnimationFrame(frame);
  return handle;
}
