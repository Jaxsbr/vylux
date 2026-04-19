---
id: idle-loses-tuning
opened_at: 2026-04-19T09:12:30Z
status: done_by_engineer
priority: P0
---

# Idle is a losing strategy — tune economy + AI aggression

## Outcome

From the player's perspective: if a player clicks their HQ (dismissing
the onboarding cue) but then takes **no further action** — no workers
placed, no raiders trained — the default AI reliably beats them. The
player's HQ is destroyed or red accrues `WIN_POINTS` before blue does.
The current build let the owner win on points while barely interacting;
this closes that.

With `offensive-reach` now shipped, red raiders auto-advance toward blue
HQ, so the functional path to this outcome exists. The task is to verify
and, where needed, tune constants and/or AI build-order cadence so idle
→ loss is reliably true on default settings, then lock it in with a
Playwright regression.

## Acceptance

- Playwright spec `tests/e2e/idle-loses.spec.ts`:
  1. Seed a fresh match as if the player just clicked the blue HQ
     (onboarding cue dismissed, but **no** buildable picked, **no** tile
     clicked, **no** unit selected).
  2. Advance time via `window.__vylux.advanceTime` in reasonable chunks
     (e.g. 1.0 s increments) up to a hard deadline (e.g. 180 s of sim
     time).
  3. Assert by the deadline: the match is over (`matchState` reports a
     terminal state), **blue has lost** — either blue HQ HP reached 0
     or red reached `WIN_POINTS` first. Blue must not win.
  4. Fail with a clear message if blue wins or the match is still
     running at the deadline.
- If the current build already satisfies the above (offensive-reach may
  have made it so), **only** add the regression spec and do no tuning.
  Capture the match outcome + blue HQ HP + final point totals in the
  handoff so the PM can judge whether the margin is healthy.
- If the current build does **not** satisfy it (blue wins or the match
  stalls), tune only the minimum needed from this list, in this order:
  1. AI build-order cadence in `src/ai.ts` — build raiders sooner /
     more often. No new unit types, no new AI behaviours.
  2. `WIN_POINTS` adjustment (up or down) if kill-point farming by red
     is slow.
  3. `BASE_INCOME` / `NODE_INCOME` rebalance only if economy curve is
     the blocker. Touch these last — owner wants "doing nothing loses"
     to be an AI-pressure problem, not an income problem.
  Keep each constant change to a one-line edit with a comment citing
  this task id.
- Existing Playwright specs must still pass, including
  `tests/e2e/mouse-end-to-end.spec.ts` and
  `tests/e2e/offensive-reach.spec.ts`. The mouse-end-to-end path must
  still end in a **blue** victory when the player actively plays.
- Unit tests for any AI cadence change (extend `src/ai.test.ts` if you
  touched `ai.ts`).

## Constraints

- Do **not** rewrite the AI. Tune its cadence, do not reshape its
  decision tree.
- Do **not** rebalance combat HP / damage numbers. Pressure should come
  from AI cadence, not from red units being stronger.
- Do **not** introduce difficulty selectors, adaptive AI, or new win
  conditions.
- Keep mouse-only input. No hotkey regression.
- Do **not** touch the other four reopen-2 tasks (tooltips, worker
  legibility, offensive-reach — already done, feedback pulses) — they
  are separate backlog items.

## Handoff

**Tuning needed: yes** — the current build (offensive-reach landed) could not win without tuning. At 1/s base income red's first raider arrived at ~220s sim-time; 180s deadline expired with blue HQ HP=500, red pts=80.

**Changes made:**

- `src/ai.ts` — two one-line edits, both cited `idle-loses-tuning`:
  1. `AI_RAIDER_MUSTER` 3 → 1: first raider advances immediately on spawn instead of waiting for a pack of 3.
  2. `BUILD_ORDER_INITIAL` reordered: `['worker','raider','worker','raider','raider','defender','raider','raider']` — raider moved to index 1 so red trains its first raider at ~120s base-income (worker at 20s, raider at 120s).
- `src/ai.test.ts` — unit tests updated to match new constants and build order (4 test descriptions + 2 expectations changed, 1 test replaced). All 264 unit tests pass.
- `tests/e2e/idle-loses.spec.ts` — new Playwright regression: seeds fresh match with onboarding cue dismissed, enables AI, advances up to 180s in 1s chunks, asserts red wins before deadline.
- `playwright.config.ts` — `idle-loses.spec.ts` added to `dev` project testMatch.

**Final outcome numbers (from passing spec):**
- Match terminated before 180s deadline with outcome `red-wins`.
- Estimated sim elapsed: ~145s (first raider trained ~120s, travels ~9.6s, attacks HQ ~15-20s).
- Blue HQ HP at loss: 0 (destroyed by red raider).
- No HP/damage rebalance, no new AI behaviours, no WIN_POINTS change, no BASE_INCOME/NODE_INCOME change.

**Screenshots regenerated:** `pm/screenshots/idle-loses-end.png`

**Verify:** `npx tsc --noEmit && npm run test && npm run test:e2e` — 59 e2e + 264 unit tests, all green.
