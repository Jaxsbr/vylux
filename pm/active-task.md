---
id: event-feedback-pulses
opened_at: 2026-04-19T09:42:20Z
status: done_by_engineer
priority: P0
---

# Event feedback pulses — place / death / node-capture / point-tick

## Outcome

From the player's perspective: when something meaningful happens in the
match, there is a brief visible cue. When a unit is placed, the tile
and/or the new unit briefly pulses. When a unit dies, its tile briefly
flashes before the mesh is removed. When a node changes ownership
(capture), the node ring pulses in the new faction's color. When the
player or AI accrues points, the HUD point counter briefly flashes. The
game no longer feels silent — players can tell what they caused.

## Acceptance

Four event types, each with its own pulse. Each pulse must be:

- Tied 1:1 to the logical event fire (not a free-running clock).
- Brief (≤ ~300ms total).
- Visible in a static screenshot captured during the pulse peak.
- Respecting the existing visual language (charcoal background, cyan
  / red-orange neon; no new palette entries, no particle systems).

### 1. Unit-placement pulse

- Fires on `trainUnit` (both factions: player mouse-driven training AND
  AI-triggered training).
- Tile under the newly-placed unit shows a short scale or emissive
  flash in the owning faction's color. Mesh scale-in tween on the unit
  itself is acceptable as the pulse (e.g. 0.4 → 1.0 over 200ms with
  ease-out).
- No pulse on scene-initial spawn (the two starter workers per
  faction). Opening state is static.

### 2. Unit-death pulse

- Fires on unit death in `combat.ts`.
- The tile under the dying unit flashes briefly (≤ 200ms) before the
  mesh disposes. Alternative: the unit mesh itself fades-out with an
  emissive spike.

### 3. Node-capture pulse

- Fires when an energy node's `computeNodeHolder` flips from one
  faction to another (or from neutral to faction).
- The node ring / hex pulses in the new faction's color for ≤ 300ms
  (scale tween or emissive spike).
- Must not fire every tick while held — only on ownership change.

### 4. Point-tick flash

- Fires on each DOM `BLUE` / `RED` point-total change in the HUD.
- The affected point counter's number flashes briefly (background
  color spike or scale tween on the counter cell, ≤ 200ms).
- Must not permanently alter HUD layout.

### Coverage

- Pure animation curves for each pulse (one shared curve is fine, or
  per-event if they need different peaks/decay). Unit-tested, no
  Three.js / no DOM in the unit tests.
- Event-to-pulse wiring tests: prove each of the four events fires
  its pulse exactly once per logical occurrence. If pure state
  machines are used for the pulse accumulators, test those directly.
- Playwright spec `tests/e2e/event-feedback-pulses.spec.ts`:
  1. Seed a match. Place a worker via mouse path, sample the unit
     mesh scale / tile emissive within 100ms of placement and assert
     it's non-baseline; sample again at 400ms and assert baseline.
  2. Force a unit death via a window.__vylux hook (`killUnit` or the
     existing damage path). Assert the death pulse visible sample.
  3. Force a node-holder flip via advanceTime with both factions'
     workers on the same node then swapping. Assert the node pulse
     visible sample on flip, not on subsequent holds.
  4. Observe a point-tick (any source — node control is easy).
     Assert the HUD counter's flash class/scale within 100ms of the
     point increment.
- Regenerate `pm/screenshots/mid-combat.png` so at least one live
  event cue is visible in the frame (a death pulse, a node-capture
  pulse, or a just-placed unit pulse). If the scene runner is
  deterministic, snap at the peak.

### Additional rubric guardrails

- No hard-fail trigger introduced. In particular point-tick flashes
  must not obscure the blue HQ silhouette.
- Do not reduce existing rubric v2 score (≥ 48 total, ≥ 7 per axis).

## Constraints

- Do **not** introduce a particle system, sprite atlas, or
  post-processing pass.
- Do **not** introduce audio.
- Do **not** touch `NODE_INCOME` / `BASE_INCOME` / `WIN_POINTS` /
  AI cadence. Balance lives under `idle-loses-tuning` (already done).
- Keep mouse-only input. No new hotkeys.
- Do **not** change the worker harvest pulse from `worker-legibility`.
  This task is about place / death / capture / point-tick — separate
  event surface.
- Reuse `computeNodeHolder` and existing HUD setters for the point
  flash. Do not duplicate authority.
- Keep existing specs green: mouse-end-to-end, offensive-reach,
  idle-loses, tooltips, worker-legibility, onboarding-cue.

## Handoff

**Commit:** `f7994a8`
**Verify:** 305 unit tests + 79 e2e tests — all green.

### What shipped

Four event-feedback pulses, each 1:1 with its logical event:

1. **Unit placement** — `triggerPlacementPulse()` called after every `trainUnit` success (player mouse path, keyboard path, AI `onTrained`). Scale-in tween 0.4→1.0 over 200ms (ease-out) on the mesh group. NOT called for scene-initial starter workers.

2. **Unit death** — `triggerDeathPulse()` called from `combat.ts` `removeDead` when `hp <= 0`. Emissive spike (150ms) on the accent/tip material. Dispose is deferred until the pulse completes; both `main.ts` and `e2e-hook.ts` advanceTime drain death-pulse units before splicing.

3. **Node capture** — `triggerCapturePulse()` called in the animate loop (and advanceTime loop) when `computeNodeHolder` returns a different value than the pre-`tickNodePoints` snapshot of `node.lastHolder`. Rim emissive spike 250ms. Does NOT fire while held, only on flip.

4. **Point-tick** — `triggerPointFlash(el)` in `hud.ts` `updatePoints` whenever the floored integer value changes. CSS `@keyframes` flash animation (180ms) added via an injected `<style>` tag. `hasPointFlashClass(faction)` exposed for e2e assertions.

### Curve choice

Single shared curve in `src/event-pulse.ts`: linear attack (first 20% of duration) + quadratic decay. Same shape as `worker-harvest-pulse` but parameterised. All four event types use it. The harvest pulse is untouched.

### Files touched

- `src/event-pulse.ts` — new pure curve module
- `src/event-pulse.test.ts` — 17 unit tests
- `src/worker.ts` — placement + death pulse methods added
- `src/defender.ts` — same; `buildDefenderMesh` now returns `{ group, accentMat }`
- `src/raider.ts` — same; `buildRaiderMesh` now returns `{ group, tipMat }`
- `src/energy-node.ts` — capture pulse methods + `capturePulseElapsed` added to `EnergyNodeBundle`
- `src/hud.ts` — CSS flash injection + `hasPointFlashClass` + point-diff in `updatePoints`
- `src/combat.ts` — `removeDead` now triggers death pulse and defers dispose
- `src/main.ts` — wires all pulse ticks in animate loop; snapshots `nodeHolderPrev` for capture diff; AI `onTrained` triggers placement pulse
- `src/e2e-hook.ts` — mirrors all pulse ticks in `advanceTime`; adds `getUnitPlacementPulseElapsed`, `getUnitDeathPulseActive`, `getNodeCapturePulseElapsed`, `getPointFlashClass`, `killUnit` hooks
- `src/debug.ts` — adds hook type declarations for new hooks
- `src/node-points.test.ts` — updated `makeNode` mock to satisfy new `EnergyNodeBundle` interface
- `playwright.config.ts` — adds `event-feedback-pulses.spec.ts` to dev testMatch
- `tests/e2e/event-feedback-pulses.spec.ts` — new 5-test spec covering all four event types
- `pm/screenshots/mid-combat.png` — regenerated with a just-placed unit at pulse peak (scale-in in progress)

### New window.__vylux hooks (justification)

All added via `e2e-hook.ts` (only active when `?e2e=1`):
- `getUnitPlacementPulseElapsed({ kind, faction, index })` — sample scale-in progress
- `getUnitDeathPulseActive({ kind, faction, index })` — confirm death pulse is running
- `getNodeCapturePulseElapsed(nodeIndex)` — sample rim emissive spike progress
- `getPointFlashClass(faction)` — confirm CSS flash class on point counter
- `killUnit({ kind, faction, index })` — force hp=0 to trigger death path without combat sim
