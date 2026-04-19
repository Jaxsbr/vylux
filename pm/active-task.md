---
id: win-lose-screen
opened_at: 2026-04-19T05:52:43Z
priority: P0
status: open
---

# Win / lose screen — VICTORY / DEFEAT overlay + in-place reset

## Outcome
Matches now end. When either faction's points cross `WIN_POINTS = 500`
**or** either HQ's HP hits 0, a full-screen overlay appears: `VICTORY` in
cyan if blue wins, `DEFEAT` in red-orange if red wins. A single
`PLAY AGAIN` button resets the match in-place — no page reload, no
lingering stale state — dropping the player back into a fresh `idle-start`
equivalent (HQs full HP, 4 starter workers per faction, points and energy
zeroed, AI re-enabled from the default, units/beams cleared).

This ticks the final MVP checklist item `Win / lose screen`, which — with
the visual-target axis already satisfied — makes the MVP **complete**.

## Acceptance
- New module `src/match.ts`. Pure match-state owner. Expose:
    - `evaluateMatch({ pointsLedger, hqs }): 'blue-wins' | 'red-wins' | null`
      — pure check; `null` while match continues.
    - Uses existing `WIN_POINTS` constant (500). Do not duplicate; import
      from wherever it lives (likely `src/mvp-config.ts` or equivalent —
      check first, add the constant there if it doesn't yet exist in a
      shared config).
    - `resetMatch(world)` — tears down current units, beams, node
      accumulators, points, HQ HP, HQ damage accumulators, AI state; then
      rebuilds the initial scene by calling the same helper `createScene`
      (or equivalent bootstrap) uses. Return value: the new world bundle
      references so `main.ts` can rebind.
- New module `src/overlay.ts` (DOM-based, echoes the existing HUD style):
    - Full-screen fixed overlay, `pointer-events: auto` on a centred
      panel but `pointer-events: none` on the backdrop so stray clicks
      don't leak through.
    - Charcoal semi-transparent backdrop (`rgba(0,0,0,0.55)`).
    - Centred panel: monospace font, neon outlined box matching HUD
      chrome. Large heading (`VICTORY` cyan / `DEFEAT` red-orange),
      subtitle showing final score (`BLUE 517  RED 362`), and a single
      button `PLAY AGAIN` styled like HUD buttons (outlined, neon
      accented).
    - Expose: `showMatchOverlay(outcome: 'blue-wins'|'red-wins', score)
      ` and `hideMatchOverlay()`.
    - Button `onclick` calls back into `main.ts` which invokes
      `resetMatch` then `hideMatchOverlay`.
- `src/main.ts` integration:
    - Each frame, after existing ticks, call `evaluateMatch`. If non-null
      AND no overlay is currently shown:
        - Pause per-frame gameplay ticks (`tickCombat`, `tickAi`,
          `tickNodePoints`, economy trickle) — guard with a
          `matchActive: boolean` flag. Rendering and HP-bar billboarding
          continue so the frozen tableau still looks alive.
        - Call `showMatchOverlay(outcome, { blue, red })`.
    - `PLAY AGAIN` handler → `resetMatch(world)` → `matchActive = true` →
      `hideMatchOverlay()`.
- HQ-death trigger:
    - If an HQ's HP reaches 0 during a `tickCombat` frame, `evaluateMatch`
      should report the opposite faction as winner (blue HQ dies → red
      wins, vice versa).
    - Do **not** auto-destroy the HQ mesh — combat already keeps it
      rendered at 0 HP per the existing spec. Overlay is the signal.
- Test-only hook additions:
    - `window.__vylux.getMatchState()` — returns
      `{ outcome: 'blue-wins'|'red-wins'|null, active: boolean }`.
    - `window.__vylux.playAgain()` — programmatic click of the button
      (bypasses DOM) for deterministic e2e.
- Unit tests (`src/match.test.ts`, pure — no DOM, no Three.js):
    - Blue at WIN_POINTS → outcome `'blue-wins'`.
    - Red at WIN_POINTS → `'red-wins'`.
    - Blue HQ hp=0 → `'red-wins'`. Red HQ hp=0 → `'blue-wins'`.
    - Both below threshold AND both HQs > 0 → `null`.
    - **Tie-break**: if both conditions trigger same frame, the side with
      strictly more points wins. If points tied, whoever reached
      WIN_POINTS this frame (track via previous ledger snapshot) wins.
      If truly simultaneous, blue wins (deterministic tiebreaker —
      document in comment above the branch).
- Playwright coverage: new spec `tests/e2e/win-lose.spec.ts`:
    - Test 1 — blue-wins-points: `setPoints('blue', 500)`, advance one
      frame, assert `getMatchState().outcome === 'blue-wins'` and
      overlay visible in DOM with text `VICTORY`.
    - Test 2 — red-wins-hq: `setUnitHp({ kind: 'hq', faction: 'blue',
      hp: 0 })`, advance, assert `'red-wins'` and `DEFEAT` text.
    - Test 3 — play-again resets: trigger blue win, call `playAgain()`,
      assert overlay gone, `getPoints('blue') === 0`,
      `getHqHp('blue') === 500`, red workers + HQ back to starter
      count, and `advanceTime(0.2)` does not re-trigger the overlay
      (meaning state is genuinely reset, not stale).
- Scene spec updates:
    - No changes to the three existing scenes. This task does **not**
      add a win-lose screenshot scene — the overlay is covered by the
      Playwright spec above, not by rubric scoring. If it's trivial to
      capture `victory.png` as a 4th scene for future bragging rights,
      feel free, but do not add it to `rubric.md`'s scenes list and do
      not expand rubric scoring scope.
- Regenerate the existing three screenshots via `npm run scenes` in case
  anything shifted, and commit.
- Verify passes (lint + type + unit + all Playwright projects). Commit to
  local `main`.

## Constraints
- Do **not** touch `pm/mvp.md`, `pm/persona.md`, `pm/rubric.md`, or
  `pm/backlog.yaml` — PM-owned.
- Do not implement: difficulty settings, statistics screen, replay,
  multi-round series, leaderboards, animations on the overlay beyond a
  subtle fade-in (optional; skip if non-trivial).
- Overlay must be DOM, not canvas-rendered. Match HUD chrome style.
- Reset must be in-place. No `window.location.reload()`. No URL param
  changes.
- Keep new LOC under ~250.
- No `git push`.

## Handoff

status: done_by_engineer

Commit: (see below — filled after commit)

### What shipped

- `src/match.ts` — pure `evaluateMatch` + `WIN_POINTS=500`. No Three.js.
- `src/overlay.ts` — DOM overlay with VICTORY/DEFEAT heading, score subtitle, PLAY AGAIN button. Backdrop pointer-events:none, panel auto.
- `src/main.ts` — `matchActive` flag gates all gameplay ticks; `evaluateMatch` called each frame; `resetMatch()` tears down units/beams/energy/points/nodes/AI and rebuilds 4 starter workers; overlay wired with play-again callback.
- `src/e2e-hook.ts` — `setUnitHp` extended for `kind:'hq'`; `getMatchState`/`playAgain` added; `evaluateMatch` called inside `advanceTime` loop so e2e tests see match state synchronously; `onMatchEnd` callback lets main.ts update its local `matchActive`/`matchOutcome`.
- `src/debug.ts` — `VyluxHook` type extended with `getMatchState`/`playAgain`.
- `playwright.config.ts` — `win-lose.spec.ts` added to `dev` project testMatch.
- `src/match.test.ts` — 10 pure unit tests (all pass).
- `tests/e2e/win-lose.spec.ts` — 3 e2e tests: blue-wins-points, red-wins-hq, play-again-resets.
- Screenshots regenerated via `npm run scenes`.

### Verify
`npx tsc --noEmit && npm run test && npm run test:e2e` — 228 unit tests + 38 e2e tests, all green.
