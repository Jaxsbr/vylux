---
id: offensive-reach
opened_at: 2026-04-19T09:01:01Z
status: done_by_engineer
priority: P0
---

# Offensive reach — raiders travel across the map and engage enemy

## Outcome

From the player's perspective: after training a raider (mouse → click HQ →
click Raider → click tile to place), the raider does not sit where placed.
It travels across the grid toward the nearest red unit or the red HQ and
exchanges fire when in range. A player cannot currently push offence across
the map — this fixes that. Combat becomes reachable.

## Acceptance

- Placing a blue raider at any tile causes it to begin moving toward the
  nearest enemy target (red unit or red HQ) as soon as it spawns. It does
  **not** require a separate move-click to start advancing.
- Target selection is re-evaluated when the current target dies or is out
  of reach. Simple: nearest-enemy-by-tile-distance, recomputed each
  pathing step. No A* — straight-line tile hops reusing the worker
  movement primitive (`worker.ts` / whichever module holds tile-hop
  movement).
- On reaching range of a target, the raider stops moving and the existing
  auto-attack loop in `src/combat.ts` takes over. When the target dies
  (or leaves range), it resumes moving to the next nearest target.
- Defender behaviour is unchanged (still stationary, attacks adjacent
  tiles). Worker behaviour is unchanged. Only the Raider gains
  auto-advance.
- Red AI raiders already try to push at blue HQ (`src/ai.ts`). Reconcile
  so both factions use the same "advance toward nearest enemy" primitive
  — AI should no longer need its own ad-hoc muster logic for raiders.
  Defender AI path is unaffected.
- New Playwright spec `tests/e2e/offensive-reach.spec.ts`:
  1. Seed a match with a blue raider placed near blue HQ (bottom-left
     corner region).
  2. Advance time via existing `window.__vylux.advanceTime` hook until
     the raider reaches within attack range of any red unit or the red
     HQ, with a reasonable deadline (e.g. 20 s of sim time).
  3. Assert: the raider's tile position changed from spawn, ended up
     on the red side of the grid (e.g. tile row/col > grid midpoint),
     and the red HQ or a red unit took damage.
  4. Write `pm/screenshots/mid-combat.png` at a moment where the blue
     raider is engaged on the red half of the map. The image must show
     a blue raider **not at the blue HQ** with a red target in frame.
- Unit test coverage on the new advance primitive (pure function taking
  units + grid, returns next-tile for a given raider). At least:
  picks nearest enemy, handles no-targets (stands still), handles
  dead-target switchover.

## Constraints

- Do **not** rewrite `src/combat.ts`. Hook the new advance-step into the
  existing per-tick loop.
- Do **not** introduce A* or any pathfinding graph. Straight-line greedy
  tile-hop per step is fine. Obstacles on a 20×20 open grid are
  non-existent by design.
- Keep mouse-only input. No new hotkeys. No attack-move keyboard verb.
- Do not alter `WIN_POINTS`, income constants, or AI build-order cadence
  in this task — tuning is a separate backlog item (`idle-loses-tuning`).
- Do not break the existing mouse-end-to-end spec
  (`tests/e2e/mouse-end-to-end.spec.ts`). If the raider now advances, the
  existing victory path should still complete — it will just look
  different (raider reaches red HQ faster).
- Reuse `window.__vylux` hooks where possible. If you add a new hook
  (e.g. `getUnitTilePosition`), justify it in the handoff.

## Handoff

### Summary

Added `src/advance.ts` — a pure `advanceRaiders` function (no Three.js, no scene) that, given a list of raiders and enemy targets, calls `moveTo` toward the nearest live enemy (workers first, then HQ) if not already in attack range (Chebyshev <= 1.5). Also exports `advanceRaidersFaction` for callers with mixed-faction arrays.

The advance step runs each tick after unit movement but before `tickCombat`, so raiders close distance every frame and the existing auto-attack loop fires when they arrive. Wired into `main.ts` (animate loop) and `e2e-hook.ts` (advanceTime loop) for both blue and red factions.

AI's ad-hoc muster logic in `ai.ts` — which hardcoded `r.moveTo(blueHq.tileX, blueHq.tileY)` — replaced with a call to `advanceRaiders` so both factions share one path. Pre-muster spawn-clearing parking is unchanged.

### Files touched

- `src/advance.ts` — new pure advance primitive
- `src/advance.test.ts` — 10 unit tests (nearest enemy, no targets, dead switchover, in-range stops, no moveTo spam)
- `src/main.ts` — import + wire advance calls before tickCombat
- `src/e2e-hook.ts` — import + wire advance in advanceTime loop; add `spawnRaider` and `getRaiderTile` hooks
- `src/ai.ts` — replace muster moveTo with advanceRaiders call
- `src/debug.ts` — add `spawnRaider` and `getRaiderTile` to VyluxHook type
- `playwright.config.ts` — add `offensive-reach.spec.ts` to dev testMatch
- `tests/e2e/offensive-reach.spec.ts` — new E2E spec

### New window.__vylux hooks

- `spawnRaider(faction, tileX, tileY) => index` — needed by the E2E spec to seed a blue raider without going through the player build panel. Returns the faction-scoped index.
- `getRaiderTile(faction, index) => {tileX, tileY} | null` — allows the spec to assert tile position mid-advance. Returns null if raider died.

Both are only present when `?e2e=1`.

### Verify output

tsc --noEmit: clean. Unit tests: 264 passed (21 files). E2E: 58 passed (0 failed).

### Screenshots regenerated

- `pm/screenshots/mid-combat.png` — shows blue raider advanced into red territory attacking the red HQ.
