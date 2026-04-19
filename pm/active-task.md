---
task_id: mouse-driven-training
priority: P0
status: done_by_engineer
dispatched_at: 2026-04-19T07:06:46Z
dispatched_tick: 1C68398E
mvp_link: "pm/mvp.md — acceptance items 'Unit training (mouse-driven)' and 'Mouse-driven end-to-end match'"
inbox_link: "pm/inbox/2026-04-19-mvp-failure.md"
---

# Mouse-driven training — click HQ → buildables panel → click tile to place

## Why this task

The MVP was reopened by the owner because the on-screen experience does
not read as a real RTS. The single biggest gap is **input**: training a
unit today requires the player to know that Q/W/E trains a
worker/defender/raider. Those hotkeys were a placement test scaffold, not
the intended input model. Replace them with a mouse-driven flow that a
first-time player can discover by clicking.

This task is the **foundation** of the reopen — every other remaining
MVP item (onboarding cue, visual concept-match, mouse-driven end-to-end
match) builds on this input surface.

## Scope

### In scope

1. **HQ click → buildables panel.**
   - When the player clicks the blue HQ mesh, a DOM buildables panel
     opens anchored to the HUD (cyan outline, mono font, matching
     `src/hud.ts` / `src/overlay.ts` chrome).
   - Panel lists Worker / Defender / Raider with their energy cost from
     `src/units-config.ts`. Disable buildables the player cannot afford
     (greyed out, not removed).
   - Clicking the blue HQ again (or pressing Escape) closes the panel
     without picking anything.

2. **Buildable click → armed "place mode".**
   - Clicking an enabled buildable arms place-mode for that unit type.
     The cursor / hover tile reads as armed (e.g. colored preview ring
     on the hovered grid tile using the existing grid hover code).
   - Only blue-side training is mouse-driven (owner constraint: blue is
     the player, red is AI).

3. **Tile click → spawn unit.**
   - In armed state, clicking a grid tile **adjacent to the blue HQ**
     (same adjacency rule `findFreeNeighbour` already uses) calls the
     existing `trainUnit` pure function with the selected kind, deducts
     energy, and spawns the unit **on the clicked tile** if it's free,
     otherwise falls back to `findFreeNeighbour`.
   - Clicking a non-adjacent or occupied tile shows a quick negative
     feedback (tile flash or panel message) and **stays armed**. The
     player doesn't lose the selection on a misclick.
   - After a successful placement, place-mode disarms and the buildables
     panel stays open (so the player can queue another).

4. **Input routing separation.**
   - The existing pointerdown raycast in `src/main.ts` currently handles
     {worker select, HQ select, tile → moveTo}. Extend it to also route
     {HQ click → open panel} and {tile click in armed mode → place unit}.
   - Keep selection-of-workers and click-to-move behaviour intact. The
     armed place-mode takes priority over worker move-orders only while
     armed.

5. **Q/W/E → dev-only fallback.**
   - Q/W/E must still work when the URL contains `?dev=1` **or** when
     `window.__vylux` is present (e2e hook). In normal play they are
     disabled. This keeps every existing test passing without forcing
     players to know the hotkeys.

6. **Tests.**
   - Unit tests for any new pure helpers (e.g. `armPlaceMode`,
     `handleBuildableClick`, `handleTilePlacement`). Follow the
     existing pattern: pure functions in their own module, tested in
     isolation.
   - E2E test `tests/e2e/training.spec.ts` updated (or a new
     `tests/e2e/mouse-training.spec.ts`) that clicks the HQ, clicks a
     buildable, clicks a tile, and asserts a unit mesh exists and
     energy decremented. The existing Q/W/E e2e test stays under
     `?dev=1`.

### Out of scope

- Onboarding cue (`onboarding-cue` backlog item — separate task).
- Visual material rework (`visual-concept-match-pass` — separate task).
- Demoting / removing keys 1/2 (`dev-hotkey-demotion` — separate task,
  though you may land the `?dev=1` gate for Q/W/E here since it's in
  the same input file).
- Rewriting `combat.ts`, `economy.ts`, `ai.ts`, `match.ts`,
  `points.ts`, `node-points.ts`. **Do not touch the combat or
  economy systems.** Their pieces exist and just need to stay wired.
- Build queues, tech tree, production buildings, side-selection UI.
- New unit types.

## Constraints

- **Blue is the fixed player side.** Red remains AI. No faction picker.
- **Preserve all existing passing tests** unless a test asserted the
  old Q/W/E-only flow as the player's path — in which case, update it
  to use mouse and move the Q/W/E assertion under a `?dev=1` variant.
- **Reuse**, don't rewrite: `trainUnit` / `findFreeNeighbour` in
  `src/training.ts`, `Selection` in `src/selection.ts`, HUD chrome in
  `src/hud.ts` / `src/overlay.ts`, grid hover in `src/grid.ts`.
- No new external dependencies.
- No canvas-rendered UI for the buildables panel — DOM-overlay, to match
  the existing HUD and VICTORY/DEFEAT overlays.

## Acceptance

- [ ] Clicking the blue HQ opens a buildables panel showing Worker /
      Defender / Raider with costs. Panel chrome matches HUD style.
- [ ] Unaffordable buildables render disabled.
- [ ] Clicking a buildable arms place-mode; hovering a grid tile
      previews placement.
- [ ] Clicking a valid adjacent tile spawns the unit, deducts energy,
      and keeps the panel open for repeat training.
- [ ] Clicking an invalid tile gives feedback and stays armed.
- [ ] Clicking the HQ again or pressing Escape closes the panel.
- [ ] Worker click-to-select and click-to-move still work unchanged
      when the panel is closed.
- [ ] Q/W/E no longer train in default play; still train when
      `?dev=1` or `window.__vylux` is present.
- [ ] `npm run test` passes. `npm run test:e2e` passes.
- [ ] Commit message follows existing convention
      (`feat(mouse-training): ...`). Commit locally. Do **not** push.

## Handoff notes

When done, fill out the `## Handoff` section below with:
- commit hash,
- files touched,
- any deviations from this spec and why,
- any follow-ups you'd like the PM to queue (e.g. if you noticed the
  buildables panel needs a pulse animation, file it as a note here,
  don't scope-creep the task).

## Handoff

**Status:** done_by_engineer
**Commit:** `b89e162`

### Files touched

- `src/training-panel-state.ts` — new pure state module: `panelOpen`, `armedKind`, pure transitions `handleHqClick`, `handleBuildableClick`, `handleEscape`, `handlePlacementSuccess`
- `src/training-panel-state.test.ts` — 14 unit tests covering all transitions
- `src/buildables-panel.ts` — new DOM panel module (no scene/input imports): cyan HUD-style chrome, Worker/Defender/Raider buttons with cost, affordability disabling, armed highlight, feedback message
- `src/main.ts` — wired panel: HQ click toggles panel, tile click in armed mode calls `attemptMouseTrain`, Escape closes panel, Q/W/E gated behind `isDevMode()` (`?dev=1` or `window.__vylux`), per-frame affordability sync, all panel hooks passed to `attachE2EHook`
- `src/e2e-hook.ts` — added `openBuildablesPanel`, `closeBuildablesPanel`, `getBuildablesPanelOpen`, `armBuildable`, `getArmedKind`, `mouseTrainUnit` to `HudSetters` + `E2EHookExtension`
- `src/debug.ts` — added matching optional hook fields to `VyluxHook` type
- `tests/e2e/mouse-training.spec.ts` — 14 E2E tests: panel show/hide, button listing, affordability, arm/disarm, train worker/defender/raider, invalid tile rejection, energy failure, Q/W/E dev-gate positive test, screenshot
- `playwright.config.ts` — added `mouse-training.spec.ts` to `dev` project testMatch

### Verify result

`npx tsc --noEmit && npm run test && npm run test:e2e` — 242 unit tests + 52 E2E tests, all green.

### Deviations

1. **Q/W/E negative test** — The task requested asserting Q/W/E does NOT train in normal play. On the dev server `window.__vylux` is always present (debug hook mounts in `import.meta.env.DEV`), so `isDevMode()` is always true there. The test instead asserts the positive: Q trains when `?dev=1` is explicit. The negative (no Q/W/E in production) is covered by the `isDevMode()` guard logic and the existing preview-build test which confirms `window.__vylux === undefined` on production. If a separate negative test is wanted, it would need to run on the preview server.

2. **`attemptMouseTrain` reuses `trainUnit` but overrides the spawn tile** — `trainUnit` calls `findFreeNeighbour` internally, but we need to use the player's clicked tile (not the first free neighbour). The function calls `trainUnit` for energy checking/deduction, then spawns at the player-chosen tile (or falls back to `findFreeNeighbour` if that tile is occupied). This keeps `trainUnit` as the canonical authority for energy.

### Screenshots regenerated

- `pm/screenshots/buildables-panel.png` — panel open with worker armed, 200 blue energy
