---
id: hq-spawn-point
opened_at: 2026-04-20T19:45:27Z
status: open
priority: P0
---

# HQ spawn point — repositionable; unblocks Raider training when HQ is walled

## Outcome

Each HQ has a designated **spawn point** (a single tile near the HQ).
Selecting the HQ makes the spawn point visible. Training any unit
(Worker / Defender / Raider) spawns the unit **at the HQ** and it
immediately **moves to the spawn point** using the existing
straight-line tile-hop mover. This replaces the current rule where a
unit requires an adjacent free tile at spawn time — which blocks Raider
training whenever the HQ is surrounded by buildings. Clicking the HQ
then clicking a valid tile (inside the HQ's 7×7 proximity zone, free of
other units/buildings, not the HQ tile itself) **relocates** the spawn
point, and the next trained unit uses the new one. The spawn point is
per-faction; the player controls only the blue one, and the AI has its
own (default fine — no AI rewrite).

Alongside the spawn-point work, fix the two rubric-v13 regressions
exposed by the post-layout mid-combat screenshot:

1. **mid-combat scene seed** — after the left/right HQ layout change,
   the scripted `tests/e2e/scenes/mid-combat.spec.ts` no longer stages
   "raiders clashing near an enemy HQ". Re-seed so the captured frame
   shows at least one blue raider + one red raider within striking
   range of the red HQ (or workers), with HP bars and/or attack beams
   visibly mid-exchange. This is scene-seed tuning, not combat balance.
2. **Onboarding cue dismissal** — the "CLICK YOUR HQ TO BEGIN" prompt
   currently persists into early-economy and mid-combat screenshots
   even though the match is clearly underway. Fix the dismissal so the
   cue clears the first time a meaningful HQ-driven action happens —
   whether that's a real mouse click on the HQ, a scripted
   `selectHq()` via the test hook, or a trained unit being spawned.
   The cue must still appear on fresh idle-start.

## Acceptance

- **Spawn-point data model** — each HQ carries a `spawnTile: {x, y}`
  field, initialised to a sensible default tile inside the HQ's
  proximity zone (e.g. one tile "in front of" the HQ toward the centre
  of the map, so blue's default spawn is a tile to the right of blue
  HQ and red's is a tile to the left of red HQ).
- **Visible indicator** — when the HQ is selected, the spawn tile is
  highlighted (e.g. cyan ring, or an edge-lit outline consistent with
  existing tile highlights). Deselecting the HQ hides it.
- **Train path** — training a Worker / Defender / Raider spawns the
  unit on the HQ tile (or as close as possible), then the unit
  immediately issues a move order to the spawn tile using the existing
  mover. No unit training ever fails because "adjacent tile is
  occupied" — the only remaining failure mode is "insufficient energy".
- **Walled-HQ regression** — add a Playwright scene / spec that
  scripts blue HQ fully surrounded by four defenders and proves a
  blue Raider can still be trained and walks out to the spawn point.
- **Reposition interaction** — with the HQ selected, clicking a valid
  tile inside the HQ's proximity zone (and not the HQ itself, not a
  unit, not an energy node) relocates the spawn point. Clicking an
  invalid tile surfaces brief HUD feedback and does NOT relocate.
  Clicking a buildable in the panel still arms place-mode as before
  (spawn-repositioning only triggers when the panel is *not* armed).
- **Unit + e2e coverage** — spawn-tile default, spawn-tile
  repositioning, train-from-walled-HQ, and the mover-to-spawn-tile
  behaviour each covered by unit or Playwright tests.
- **Mid-combat scene seed fix** — updated
  `tests/e2e/scenes/mid-combat.spec.ts` regenerates
  `pm/screenshots/mid-combat.png` showing raiders clashing near the
  red HQ (or red workers) under the left/right layout. Re-scoring
  that scene under rubric v2 must return composition ≥ 7 and
  silhouette ≥ 7.
- **Onboarding cue dismissal fix** — the overlay clears on any first
  HQ-driven action (click, scripted `selectHq`, or first successful
  `trainUnit`), not only on an explicit DOM click. Regenerated
  `pm/screenshots/early-economy.png` and `pm/screenshots/mid-combat.png`
  do NOT contain the onboarding cue. Regenerated
  `pm/screenshots/idle-start.png` DOES still contain it.
- `mouse-e2e-victory` and `idle-loses-end` remain green under the new
  spawn-point flow.

## Constraints

- Mouse-only input. Do NOT add a keyboard shortcut for relocating the
  spawn point.
- Do NOT change the proximity-zone size (7×7, radius 3) or the layout
  (blue left / red right, 3-tile inset). Those are load-bearing from
  the previous task.
- Do NOT touch the worker task loop, node exhaustion, node neutral
  visuals, or worker animation model in this task — that's the next
  task (`worker-task-loop`). Workers still tick passively on nodes for
  now.
- Do NOT alter combat numbers, AI build order, or economy constants
  beyond what's strictly needed to keep `idle-loses-tuning` green
  after the spawn-point change. If AI Raider behaviour drifts because
  red's spawn tile differs from where its raiders used to appear, tune
  only the minimum needed.
- No new pathfinding. Reuse the existing straight-line tile-hop mover.
  If the spawn tile is blocked at train time, unit walks as close as
  it can (consistent with current blocked-tile handling) — do NOT
  introduce A*.
- Keep existing `placement.ts` helpers (`proximityZoneTiles`,
  `isInProximityZone`) as-is. Add new helpers for spawn-tile
  validation; don't refactor the placement module wholesale.
- Keep the existing buildables panel structure in `src/hud.ts` /
  `src/training.ts` untouched apart from the minimal wiring needed to
  distinguish "panel armed" vs "panel idle" click handling on the HQ.

## Handoff

(Empty. Engineer fills this in with a summary + commit SHA on completion.)
