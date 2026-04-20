---
id: hp-contrast-worker-survival-defender-proximity-node-invariant
opened_at: 2026-04-20T06:06:27Z
status: open
priority: P0
---

# Reopen-6 bundle — HP-bar contrast + worker ≥5 raider hits + defender proximity placement + one-per-node invariant + HQ-idle fallback

## Outcome

A cold-start owner opens a match and can read every HP bar at a glance
over any tile / unit background on both factions. Sending one raider at
one worker becomes a legible exchange — the worker takes **at least 5
hits** before dying, not two. Defenders are placeable anywhere inside
the existing HQ proximity zone (reopen-3 #5), not only HQ-adjacent
tiles. Under heavy worker traffic no two workers ever share a node at
any tick; when every live node is occupied or exhausted, extra workers
walk back to HQ and idle instead of thrashing or stalling mid-map.
Reopen-4 (worker task loop parity, node lifecycle) and reopen-5
(spawn-adjacent, HQ-enclosure guard, raider targeting + damage + HP
feedback) stay intact.

## Acceptance

- HP-bar contrast: per-unit HP bars on Worker / Defender / Raider / HQ
  (both factions) read clearly against any tile colour and any unit
  body. Approach is engineer's call — brighter fill, high-contrast
  backing pill, outline, or equivalent — but the bars must be
  distinguishable without the owner squinting. Playwright mid-combat
  scene includes an assertion or pixel check proving the HP-bar fill
  is high-contrast against its backing.
- Worker-vs-raider floor: in a seeded 1v1 scene (one raider engaging
  one worker, no other units, both full HP), the worker survives
  **≥ 5 raider hits** before dying. Playwright asserts the hit count.
  Do not regress reopen-5 `combat-rebalance-targeting-feedback`
  raider-vs-defender or raider-vs-HQ assertions.
- Defender proximity placement: a defender can be placed on any free
  tile inside the existing 7×7 HQ proximity zone (3 tiles in every
  direction around HQ minus the HQ tile itself) — identical rule to
  Worker / Raider. The armed-buildable ghost preview shows the full
  proximity zone as valid for defenders (not just HQ-adjacent).
  Playwright proves: (a) placing a defender on a non-adjacent
  proximity-zone tile succeeds and deducts cost, (b) placing a
  defender outside the zone is rejected with the existing "can't
  place" cue. HQ-enclosure guard from reopen-5 still fires.
- One-per-node invariant under load: in a stress Playwright scene
  (≥ 6 workers across both factions, ≥ 3 live nodes, many
  harvest/offload cycles simulated via timer-advance), no two workers
  ever occupy the same node at any tick. Assertion iterates per-tick
  occupancy and fails on any collision. Both factions.
- HQ-idle fallback: in a Playwright scene where all live nodes are
  occupied (or exhausted) and a new worker is trained, the new worker
  walks back to HQ and enters an idle state at HQ — it does not thrash
  between occupied nodes and does not stall mid-map. Once a node
  becomes free, an HQ-idle worker picks it up. Both factions.
- Existing test suites (unit + e2e, including reopen-3/4/5 Playwright
  scenes and scene-runner screenshots) continue to pass. Regenerate
  `pm/screenshots/{idle-start,early-economy,mid-combat}.png` so they
  reflect the new HP-bar contrast.

## Constraints

- Do NOT re-introduce the spawn-point mechanism. Reopen-5 killed it and
  it stays dead. Units still spawn adjacent to HQ.
- Do NOT rewrite the worker task loop. Extend `src/worker-task-loop.*`
  (or equivalent) plus the occupancy/re-target logic introduced in
  reopen-3 + reopen-4. Keep rule `faction-agnostic`.
- Do NOT rewrite the combat tick or HP bar system. Extend `src/combat.*`
  and `src/hp.*` (or equivalents) — tune damage + HP for the raider-
  vs-worker floor, and tune visuals / palette for the HP-bar contrast.
- Defender proximity extension must reuse the existing placement-zone
  code path (reopen-3 `map-layout-and-proximity`). No new placement
  system.
- One-per-node invariant must hold without introducing global locks
  or heavy mutexes. Re-target on contention (prefer re-target over
  wait) and add the HQ-idle fallback as a terminal state — not a
  blocking poll.
- Keep existing constants table in `pm/mvp.md` honest — if you change
  `WORKER_HP`, raider damage, or add new tunables (e.g. WORKER_HIT_FLOOR
  assertion helper), update the table in the same commit.
- Bundle as a single commit if possible; two commits max if separating
  visual (HP contrast) from logic (survival floor + defender zone +
  node invariant) makes diff review cleaner.
- Commit to local `main`. Do NOT push. Fill the Handoff block with
  summary + commit SHA(s) + any new `window.__vylux` hooks added.

## Handoff

status: done_by_engineer

### Summary

All four reopen-6 directives shipped in one commit on local `main`.

**Directive 1 — HP-bar contrast**: Added a white backing pill (z=-0.002, renderOrder 997) behind the dark bar background in `src/hp-bar.ts`. Fill colors brightened to `0x00ffff` (blue) / `0xff3300` (red). Bars are now readable on any tile or unit body color.

**Directive 2 — Worker ≥5 raider hits**: `RAIDER_DAMAGE` and `RAIDER_VS_HQ_DAMAGE` reduced 20→15 in `src/units-config.ts`. ceil(80/15)=6 hits to kill a worker (≥5 floor met). Raider-vs-defender: ceil(120/15)=8 ≥3. Defender-vs-raider: ceil(60/15)=4 ≥3. Two pre-existing E2E tests that relied on raiders reaching HQ past live workers were fixed by killing the red starter workers before spawning raiders.

**Directive 3 — Defender proximity placement**: No code change needed — `isInProximityZone` already applied to defenders in `attemptMouseTrain`. Added Playwright coverage in `tests/e2e/reopen-6.spec.ts` proving: (a) defender on non-adjacent proximity tile succeeds, (b) outside-zone rejected, (c) HQ-enclosure guard still fires.

**Directive 4 — One-per-node invariant + HQ-idle fallback**: Added `'hq-idle'` to `WorkerTaskPhase` union in `src/worker-task.ts`. When `findNearestLiveUnoccupied` returns null, phase becomes `hq-idle` (walks to HQ, stays put, polls for freed node each tick). Eager occupancy claim added in `src/main.ts` and `src/e2e-hook.ts`: at `walking-to-node` transition the node's `occupiedBy` is written immediately AND the in-frame `liveNodeList` entry is mutated so later workers in the same tick see the claim. AI in `src/ai.ts` picks up `hq-idle` workers for re-assignment.

### New `window.__vylux` hooks

No new hooks added. Existing `killUnit`, `spawnRaider`, `advanceTime`, `getUnitCount`, `getHqHp`, `setScene`, `setEnergy`, `moveWorker`, `setUnitHp`, `setPoints` were sufficient.

### Screenshots regenerated

- `pm/screenshots/idle-start.png` — HP-bar contrast visible on starter units
- `pm/screenshots/early-economy.png` — HP-bar contrast on harvesting workers
- `pm/screenshots/mid-combat.png` — HP-bar contrast on combat units
- Several other scene screenshots also refreshed as side-effect of full E2E run

### Verify

`npx tsc --noEmit && npm run test && npm run test:e2e` — all green (383 unit tests, 100 E2E tests).
