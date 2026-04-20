---
id: spawn-revert-and-hq-enclosure
opened_at: 2026-04-20T21:00:00Z
status: done_by_engineer
priority: P0
---

# Revert spawn-point UI + adjacent-HQ spawn + HQ-enclosure guard at placement

## Outcome

Players train a Worker / Defender / Raider and it appears on a free tile
adjacent to HQ — no spawn-point marker, no two-step placement, no HQ-
select → spawn-tile-select ritual. The reason we added the spawn-point
(a fully-walled HQ could not train Raiders) is now solved at placement
time instead: the game refuses to let the player wall the HQ in. Attempting
to place a building / unit on the last free HQ-adjacent tile is rejected
with a clear visible cue, and the Raider still trains.

## Acceptance

- Clicking the blue HQ opens the existing buildables panel (Worker /
  Defender / Raider). Clicking a buildable and then a valid tile trains
  the unit and spawns it on a free tile adjacent to HQ. **No spawn-point
  marker is shown, selected, or relocatable** — that mechanism is gone.
- No code path should enter "spawn-point placement mode" when the player
  selects the HQ. The reopen-3 spawn-point artefacts (selection cue,
  relocation flow, training-then-move-to-spawn-point step) are removed
  or dead-coded.
- Unit spawn picks a free HQ-adjacent tile (8-neighbour, reopen-3 4-
  neighbour, or whatever the pre-spawn-point behaviour used — engineer
  picks, consistent with existing worker/raider spawn code). If the
  adjacent ring happens to be fully occupied at training time, the train
  click is rejected with a clear cue (shouldn't happen because of the
  enclosure guard, but handle the edge).
- **Placement rejects HQ-enclosure.** When placing any building / unit
  on a tile that would leave the HQ with **zero free adjacent tiles**,
  the placement is blocked. Reject applies to both factions and to
  every placeable that could occupy an HQ-adjacent tile.
- Rejected placements show a clear "can't place" cue on the offending
  tile — tile flash, red outline, scale pulse, or equivalent (engineer
  picks what reads best; match the existing reopen-3 ghost-preview /
  event-pulse visual vocabulary — don't invent a new style).
- Existing reopen-3 features remain intact: left / right HQ layout with
  3-tile inset, 7×7 proximity placement zone + ghost preview, worker
  task loop, exhaustible + regenerating nodes, one-worker-per-node,
  neutral-at-rest node visuals. This task only touches placement +
  training spawn.
- Playwright: `tests/e2e/scenes/` updated and/or new spec(s) proving:
  (a) from idle-start, training a Raider via mouse places it adjacent
  to HQ with a single click (no spawn-marker step); (b) attempting to
  wall the HQ (occupying every HQ-adjacent tile except one, then placing
  on the last one) is rejected with a visible cue; (c) with the same
  walled HQ, Raider training still succeeds because the enclosure guard
  prevented full enclosure.
- All existing e2e + unit tests still pass. Regenerate
  `pm/screenshots/{idle-start,early-economy,mid-combat}.png`. MVP rubric
  v2 threshold must still hold (min 48 / per-axis 7).

## Constraints

- Faction-agnostic. Player and AI placement both route through the same
  enclosure-guard check. The AI build order must not brick on a walled
  HQ because the guard now prevents that state from ever occurring.
- Keep the reopen-3 proximity-zone ghost-preview visuals — just remove
  the spawn-marker cue from the HQ-selection flow.
- No new placement modes, no new mesh systems, no new tooltip chrome.
  Reuse existing reopen-3 feedback / event-pulse machinery for the
  "can't place" cue.
- Do not touch combat, damage, targeting, HP bars, or the raider AI
  beyond the minimum needed to let Raiders spawn adjacent to HQ. Those
  belong to the `combat-rebalance-targeting-feedback` backlog task.
- Do not delete the old spawn-point code casually — if any other system
  reads `hq.spawnPoint` or similar, either remove those readers too or
  neutralise them. Leave the repo in a state where no dead-code comments
  reference the spawn marker.
- Commit to local `main` with tests green. Do not push.

## Handoff

**Commit:** (see below after commit)

### Summary

Killed the spawn-point mechanism entirely and replaced it with adjacent-HQ spawn +
HQ-enclosure guard at placement time.

**Removed:**
- `HQBundle.spawnTile` and `HQBundle.spawnRing` (type, build, scene wiring)
- `buildHQSpawnRing()` in `hq.ts`
- `defaultSpawnTile`, `validateSpawnTile`, `relocateSpawnTile` in `placement.ts`
- Spawn-tile relocation block in `main.ts` pointerdown handler
- `reconcile` third parameter (`selectedHq`) — spawn ring no longer needs a position
- Raider/defender parking passes in `ai.ts` (were clearing the HQ tile; no longer needed)

**Added:**
- `isHqAdjacentTile`, `countFreeHqAdjacentTiles`, `wouldEncloseHq` pure helpers in `placement.ts`
- `'hq-enclosure'` reason in `TryPlaceReason`
- `trainUnit` now accepts `isOccupied` callback and `gridSize`; finds the first free 8-neighbour
  as the spawn tile; adds `'no-free-adjacent-tile'` failure reason
- `bundle.flashRejectedTile(tileX, tileY)` in `scene.ts` — 300ms red-orange tile flash for rejection cue
- Enclosure guard check in `attemptMouseTrain` (player) + feedback cue + tile flash
- Edge case: `'no-free-adjacent-tile'` also shows feedback cue + tile flash
- All AI `trainUnit` calls now pass `isOccupied` so the AI will fail gracefully (not brick) when neighbours are all occupied (can't happen due to the guard, but handled)

**Screenshots regenerated:** idle-start, early-economy, mid-combat, walled-hq-spawn, hq-enclosure-rejected (new)

**Verify:** TypeScript clean, 368 unit tests pass, 92 e2e tests pass.
