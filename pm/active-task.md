---
id: ai-worker-parity-and-node-lifecycle
opened_at: 2026-04-19T23:10:04Z
status: done_by_engineer
priority: P0
---

# AI worker parity + node occupancy release + node regeneration

## Outcome

Owner watches a match and sees **both** factions' workers following the
same visible walk → harvest → walk-back to HQ → offload loop that
reopen-3 landed for blue. A node becomes free the instant its current
worker leaves (to offload, to seek a new node, on death, or on
reassignment), so the next available worker of either faction can claim
it immediately. Exhausted nodes slowly regenerate on their own and
return to life without human intervention — but harvest rate stays
dominant so a player can't just wait the map out. No changes to combat,
unit types, AI build order, or placement. Purely parity + lifecycle
fixes on top of the reopen-3 worker/node foundation.

## Acceptance

1. **AI worker parity** — red workers use the same task loop module as
   blue workers: path to a live node, harvest into a local buffer,
   path back to the **red** HQ, offload into red's energy pool, repeat.
   - No direct-on-tile passive AI income remains. If the old AI path
     called `tickEnergyWithNodes` / `NODE_INCOME` per-tick for red, it
     must route through the task loop instead.
   - AI task assignment: an idle red worker auto-seeks the nearest
     unoccupied live node (same heuristic the reopen-3 auto-retarget
     uses for blue). Player manual assignment for blue is unchanged.
   - Unit-test coverage on the red assignment heuristic + one
     Playwright scene showing a red worker traveling **node → red HQ →
     node** over time (advance-time helper is fine).

2. **Node occupancy releases when the worker leaves** — a node's
   `occupantId` (or equivalent) clears the moment the assigned worker
   departs, across all exit paths:
   - Walking back to HQ to offload.
   - Seeking a different node (e.g. current one just exhausted).
   - Death in combat.
   - Explicit reassignment by the player (blue) or the AI (red).
   - Second worker pathing toward a now-occupied node re-targets to the
     nearest unoccupied live node instead of waiting. Applies to both
     factions.
   - Playwright / unit test: worker A harvests → leaves to offload →
     **during** A's return trip, worker B can start harvesting the same
     node. No "wait until A comes back" softlock.

3. **Nodes regenerate after exhaustion** — exhausted nodes slowly
   refill `reserve` over time and become eligible again once
   `reserve ≥ MIN_REGEN_THRESHOLD` (pick something small, e.g. 10% of
   initial capacity).
   - Regeneration rate is at least **5× slower** than per-worker
     collection rate. Pin the exact values in `src/constants.ts` or
     wherever reopen-3 exposed node tunables, and document the ratio.
   - Visuals: exhausted node stays in its current dim/dead look until
     it crosses the re-eligible threshold, then snaps back to the
     reopen-3 neutral-at-rest look (white-core, faint neutral glow).
   - Unit test proves: after exhaustion, advancing simulated time by
     N seconds with no worker nearby brings the node back to eligible.

4. **Playwright scene coverage updated — no regressions** — the three
   existing scenes (`idle-start`, `early-economy`, `mid-combat`) still
   render and commit PNGs to `pm/screenshots/`. Mid-combat's screenshot
   should still read as an RTS in progress; no scene renamed or
   deleted. Add new specs under `tests/e2e/scenes/` or
   `tests/e2e/*.spec.ts` as needed for the new assertions above — do
   not fold them into existing scene specs if it makes them noisy.

5. **All previously-ticked acceptance items still pass.** In
   particular reopen-3 blue worker loop, one-worker-per-node, neutral
   node visuals, and the 7×7 proximity zone must not regress.

## Constraints

- **Extend the existing worker-task-loop machinery**; do NOT branch a
  second copy for AI. If the current task-loop lives in something like
  `src/workerTaskLoop.ts` / `src/nodes.ts`, make it faction-agnostic
  and call it from the AI tick. A duplicated AI-only path is a red
  flag and will be rejected.
- Keep the reopen-3 state-machine shape for per-worker state
  (idle / walking-to-node / harvesting / walking-to-hq / offloading).
  Add states only if strictly necessary; prefer re-using.
- Keep the MVP constants table in `pm/mvp.md` honest — if you add a
  new constant (`NODE_REGEN_RATE`, `MIN_REGEN_THRESHOLD`, etc.),
  append it to that table in your handoff notes so the PM can
  propagate.
- No A*, no new unit types, no new AI build-order entries, no combat
  changes. Don't rewrite pathfinding — re-use whatever reopen-3 used.
- Do not break the mouse-driven end-to-end test. If tuning regen/
  collection rates affects the "idle-loses" regression, re-tune rather
  than disabling the test.
- Read `AGENTS.md` and `pm/mvp.md` (including the new "Reopen 4"
  section) before coding. Run the repo's verify command. Commit to
  local `main` when green. Do **not** push.
- If you hit 5 failed attempts on the same sub-problem, write a
  `pm/learnings/engineer-<date>-<topic>.md` note and stop — don't
  thrash.

## Handoff

**Commit:** `3921adf`

Red workers now run the identical walk→harvest→walk-back→offload task loop as blue — no separate passive AI income path remains. Node `occupiedBy` clears the moment a worker transitions out of the `harvesting` phase (not deferred), so a second worker can claim the node while the first is returning to HQ. Exhausted nodes regen at `NODE_REGEN_RATE = 0.4 reserve/s`, becoming eligible once `reserve >= MIN_REGEN_THRESHOLD = 6` (10% of `RESERVE_DEFAULT = 60`). All three existing scene screenshots regenerated; two new specs added (`ai-worker-parity.spec.ts`, `node-lifecycle.spec.ts`). 90/90 e2e + 369/369 unit tests pass.

**New tunables to add to `pm/mvp.md` constants table:**
- `NODE_REGEN_RATE = 0.4` — reserve units per second restored when node is below MIN_REGEN_THRESHOLD (5× slower than harvest rate 2.0/s)
- `MIN_REGEN_THRESHOLD = 6` — minimum reserve before node is eligible again (10% of RESERVE_DEFAULT=60)

**Screenshots regenerated:**
- `pm/screenshots/harvest-loop.png` (new — mid-harvest with fill bar on blue-tinted node)
- `pm/screenshots/ai-worker-parity.png` (new — red worker mid-harvest at node)
- `pm/screenshots/early-economy.png`, `idle-start.png`, `mid-combat.png`, `idle-loses-end.png`, `mouse-e2e-victory.png`, `walled-hq-spawn.png` (refreshed)
