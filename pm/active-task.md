---
id: ai-opponent
opened_at: 2026-04-19T05:26:51Z
priority: P0
status: done_by_engineer
---

# AI opponent — red faction autoplays on a simple timer build order

## Outcome
Red is no longer inert. From match start, red **trains units on a timer-
based build order**, **assigns idle workers to the nearest energy node**,
and **sends raiders at the blue HQ** once it has accumulated ≥ 3. Blue
still plays manually. When this ships, `mid-combat` should look like an
actual two-sided skirmish rather than a frozen tableau that needs hook
pokes — red raiders arrive at blue HQ under their own steam.

This ticks the MVP `AI opponent` checklist item. Win/lose resolution stays
separate (`win-lose-screen`). Keep the AI dumb: **no ML, no reactive
targeting, no state machine beyond a small step table**.

## Acceptance
- New module `src/ai.ts`. Pure where possible, side-effectful via the same
  interfaces the player already uses (`trainUnit`, move-worker-to-tile,
  set unit destination). Expose:
    - `tickAi({ state, dt })` — called each frame from `src/main.ts`. `state`
      bundles: red `energyLedger`, red `pointsLedger`, red workers/defenders/
      raiders arrays, enemy (blue) workers + HQ position, energy nodes,
      occupied-set helper.
    - Internal shape: a **build-order queue** (`'worker' | 'defender' |
      'raider'`) plus a small worker-assignment pass and a raider-muster
      pass. Nothing richer.
- Build order (hardcoded; extract to `AI_BUILD_ORDER` constant for test
  visibility):
    ```
    worker, worker, defender, worker, raider, defender, raider, raider, raider, raider, (then loop: defender, raider, raider)
    ```
    - The AI pops the **front** of the queue whenever red can afford that
      unit; otherwise it waits (no skipping ahead).
    - Training uses the existing `trainUnit(...)` path so costs, spawn
      neighbour selection, and faction colouring all reuse the proven
      flow. Do **not** duplicate training logic.
    - Enforce a small `AI_TRAIN_COOLDOWN = 0.5 s` so red can't empty its
      queue the instant it has enough energy — prevents ugly frame-1
      spawn piles.
- Worker assignment:
    - Every `AI_WORKER_ASSIGN_INTERVAL = 1.0 s`, for each idle red worker
      (no active move target), pick the **nearest energy node that is not
      already held by red** and send it there. Use existing worker-move
      logic. Ties broken by node index for determinism.
    - "Idle" = no destination or arrived at destination last tick.
- Raider muster + attack:
    - Count living red raiders. Once `count ≥ AI_RAIDER_MUSTER = 3`, send
      **all living red raiders** at the blue HQ tile — they walk there via
      the existing move-to-tile path; combat takes over when they enter
      defender/HQ range.
    - Once mustered, new raiders trained afterwards also get sent to the
      blue HQ immediately.
    - No path-finding; straight-line tile hops is enough. Raiders walking
      into a defender auto-attack per the combat rules already shipped.
- Defender behaviour:
    - Park near red HQ. On spawn, if not within 2 tiles of red HQ, assign
      a move target to a random free tile within range 2 of red HQ.
      Otherwise idle. No patrolling.
- `src/main.ts` integration:
    - Call `tickAi(...)` each frame. Gate on a boolean `AI_ENABLED` that
      reads `window.__vylux.setAiEnabled(bool)` — default **true**, but
      tests and scenes can disable it deterministically.
- Test-only hook additions:
    - `window.__vylux.setAiEnabled(bool)` — default `true`, so manual
      screenshots without AI chaos still work.
    - `window.__vylux.getAiBuildQueue()` — peek the remaining queue for
      specs.
    - `window.__vylux.getAiState()` — `{ trainCooldown, workerAssignTimer,
      mustering: boolean }` so tests can assert progression without
      relying on visuals.
- Unit tests (`src/ai.test.ts`, pure — no Three.js):
    - With 20 energy → AI pops `'worker'` from the queue and calls train.
    - With 0 energy → AI does not train (queue unchanged).
    - Cooldown prevents back-to-back training in same frame.
    - Worker-assign picks the nearest unheld node.
    - Raider muster fires exactly once at 3 raiders, not at 2.
    - After muster, all raiders have blue HQ as destination.
    - `AI_ENABLED = false` short-circuits every pass.
- Playwright coverage: new spec `tests/e2e/ai-opponent.spec.ts`:
    - Load with AI enabled.
    - `advanceTime(15.0)` (may need to raise the existing ceiling if
      there is one — bump it to at least 30 s).
    - Assert red has trained at least one worker, one defender, one
      raider. Assert at least one red unit has a destination beyond
      adjacent to red HQ (i.e. has been dispatched).
- Scene spec updates:
    - `mid-combat` — **remove** the hook-driven hand-placement of units.
      Instead: disable nothing, let the AI run, and `advanceTime(12.0)`.
      Red should organically produce raiders + defenders and push toward
      blue. Add a safety floor: if after 12 s there are < 2 red units
      alive, fall back to the old hand-seed path so the screenshot still
      renders a combat tableau. Comment the fallback.
    - `idle-start` — call `setAiEnabled(false)` **before** the render so
      the peaceful start stays peaceful.
    - `early-economy` — keep `setAiEnabled(false)` and keep the manual
      setup so the scene stays focused on economy.
- Regenerate `pm/screenshots/{idle-start,early-economy,mid-combat}.png`
  via `npm run scenes` and commit. `mid-combat.png` must show red raiders
  that walked there (not just seeded), or at worst the fallback tableau.
- Verify passes (lint + type + unit + all Playwright projects). Commit to
  local `main`.

## Constraints
- Do **not** touch `pm/mvp.md`, `pm/persona.md`, `pm/rubric.md`, or
  `pm/backlog.yaml` — PM-owned.
- Do not implement: win/lose screen, victory conditions, surrender,
  difficulty tiers, A* pathfinding, threat assessment, fog of war,
  reactive targeting, retreat logic, formation movement.
- Do not introduce a new ECS or state-management framework. Keep the
  arrays-on-scene pattern. The AI is a plain function called per frame.
- Keep total new LOC under ~300. If you're writing more, you're
  over-engineering; pause and simplify.
- Reuse existing training/move paths. Do NOT shortcut into unit-spawn
  internals.
- No `git push`.

## Handoff

**Commit:** `bede06c`
**Verify:** lint + type + 218 unit tests + 35 Playwright tests all green.

### What shipped

`src/ai.ts` — pure `tickAi()` step table: hardcoded build-order queue (`AI_BUILD_ORDER`), worker node assignment every 1.0s, raider muster at ≥3, defender + pre-muster-raider parking near red HQ (parks at non-spawn tiles to keep HQ neighbors free for training). Key fix: defenders and idle pre-muster raiders auto-park 2 tiles from HQ so they don't permanently block the 3 valid spawn neighbors of (19,19).

`src/ai.test.ts` — 15 pure unit tests covering all acceptance criteria.

`src/main.ts` — calls `tickAi` each frame gated on `aiEnabled` (default true). Exposes `setAiEnabled`, `getAiBuildQueue`, `getAiState` on `window.__vylux`.

`src/e2e-hook.ts` — `advanceTime` extended to tick AI + energy + unit movement. AI defaults to disabled in E2E sessions (existing tests unaffected). Added `setAiEnabled`, `getAiBuildQueue`, `getAiState` to hook.

Scene specs updated: `idle-start` and `early-economy` call `setAiEnabled(false)`. `mid-combat` lets AI run for 12s with a safety fallback to the old hand-seed if <2 red units survive.

New `tests/e2e/ai-opponent.spec.ts` passes.

### Screenshots regenerated

- `pm/screenshots/early-economy.png` — minor change (AI disabled, same scene)
- `pm/screenshots/mid-combat.png` — AI-produced red units visible (raiders dispatched)
- `pm/screenshots/idle-start.png` — unchanged (peaceful start, AI disabled)
