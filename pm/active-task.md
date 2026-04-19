---
id: worker-unit
opened_at: 2026-04-19T04:37:15Z
priority: P0
status: done_by_engineer
---

# Worker unit — real mesh + selectable + click-to-move

## Outcome
Workers stop being e2e-only placeholder cubes and become a real unit type
in the game. Per MVP, both factions spawn one HQ + **two workers** at
opposite corners when the match starts. Each worker:

- Has its own faction-coloured mesh (not a box — an angular low-poly wedge
  or diamond prism that reads as "unit" and matches the HQ visual language).
- Can be **selected** by left-clicking on its mesh (selection ring appears
  beneath it).
- Can be **moved** by left-clicking an empty grid tile while selected —
  the worker walks along a straight-line tile hop path (no A*, no
  collision avoidance; just `Math.sign` the delta each frame until it
  reaches the target).
- Is a **blue-faction-only** input concern for now — red workers exist on
  the grid (AI will drive them later) but clicking them deselects the
  current selection; red workers do not respond to player clicks.
- Harvesting / `NODE_INCOME` multiplier is **out of scope** for this task —
  a later `worker-harvesting` task wires movement into the energy ledger.

This unblocks `unit-training`, `combat`, and `ai-opponent` downstream.

## Acceptance
- New `src/worker.ts` module exposing:
    - `buildWorker(faction, tileX, tileY)` → returns a `WorkerBundle` with
      `{ mesh: Three.Object3D, setTile(x, y), moveTo(x, y), tick(dt) }`.
    - Mesh is **not** a plain box. Shape suggestion: small diamond-prism or
      wedge with beveled edges, emissive faction colour body, thin outline
      edges (same EdgesGeometry pattern as HQs). Scale so one worker
      comfortably fits one tile footprint.
    - `tick(dt)` advances the worker toward its target tile at a fixed
      tiles-per-second rate (pick a value — something like 2 tiles/s feels
      right for RTS pacing). Movement is straight-line in tile space;
      diagonals allowed, no pathfinding.
- New `src/selection.ts` module:
    - Tracks the currently-selected worker (single-select for MVP) at the
      blue-faction level. Exposes `selectWorker(w | null)` and `getSelected()`.
    - Renders a thin cyan ring on the ground under the selected worker's
      tile (reuse grid tile outline geometry if convenient). Ring
      disappears on deselect.
- Input wiring in `src/main.ts` (or a small `src/input.ts` sibling):
    - Left-click raycasts against worker meshes and the grid plane.
    - If the ray hits a blue worker → select it.
    - If a blue worker is selected and the ray hits the grid plane → move
      the worker to that tile.
    - If the ray hits a red worker / HQ / node → deselect.
    - Right-click is not used in this task.
- `createScene()` spawns the starting units per MVP:
    - Blue: HQ at `(0, 0)` (already there), two workers at `(1, 0)` and
      `(0, 1)`.
    - Red: HQ at `(19, 19)` (already there), two workers at `(18, 19)` and
      `(19, 18)`.
- The test-only `window.__vylux` hook:
    - Stops seeding placeholder worker/raider cubes — those are gone.
    - Exposes `spawnWorker(faction, tileX, tileY)` for scenes that want
      more workers than the default 2+2.
    - Exposes `moveWorker(index, tileX, tileY)` so scene specs can
      deterministically position workers before screenshotting.
- Scene specs update:
    - `early-economy` uses `spawnWorker` + `moveWorker` to place 3 blue
      workers around blue HQ (one on a node) and 3 red workers near red HQ.
    - `mid-combat` seeds a small cluster of blue workers near red HQ for
      the "pushing into the base" read. Raider placeholders can stay as
      whatever the hook does today if you need a "raider" read — the real
      raider mesh is a future task.
- Unit tests for `worker.ts`:
    - `buildWorker` returns a Mesh tree with faction-coloured emissive.
    - `moveTo` + repeated `tick` eventually reach the target tile (within
      a small epsilon) and stop.
    - Direction changes mid-move if `moveTo` is called again.
- Unit tests for `selection.ts`:
    - `selectWorker(w)` + `getSelected()` round-trip.
    - `selectWorker(null)` clears the selection.
- Playwright coverage: one new spec under `tests/e2e/` (not in `scenes/`)
  that boots the app without `?e2e=1`, clicks a blue worker, clicks a
  distant tile, waits a beat, and asserts the worker's tile changed (via
  the `window.__vylux` read-side — you can expose a
  `getWorkerTile(index)` helper for assertions only). Keep it headless
  and fast.
- Regenerate `pm/screenshots/{idle-start,early-economy,mid-combat}.png`
  via `npm run scenes`. Idle-start now shows the 4 starter workers (2 blue
  + 2 red). Committed.
- Verify passes (lint + type + unit + all Playwright projects). Commit to
  local `main`.

## Constraints
- Do **not** touch `pm/mvp.md`, `pm/persona.md`, `pm/rubric.md`, or
  `pm/backlog.yaml` — PM-owned.
- Do not implement harvesting / `NODE_INCOME` income changes — that's a
  dedicated follow-up task.
- Do not implement combat, unit training hotkeys, AI, or win/lose. Those
  are future tasks. Even if a 10-line patch would let workers attack,
  defer.
- Do not introduce A*, flow fields, or any pathfinding library. Straight-
  line tile hops only.
- No new runtime deps.
- No `git push`.

## Handoff

- **Mesh shape:** Diamond prism — two `CylinderGeometry(0, 0.28, 0.22, 4)` cones stacked tip-to-tip (upper cone apex up, lower cone apex down), each with `EdgesGeometry` trim in the faction emissive colour. Reads as a distinct angular "unit" silhouette vs the HQ's stepped tiers and the node's flat hex. Total height ~0.44, fits comfortably on one tile.
- **Worker speed:** `WORKER_SPEED = 2` tiles/second, straight-line lerp in floating-point tile space. `tileToWorld` only accepts integers so a local `tileFloatToWorld` helper converts sub-tile floats without the integer assertion. `tileX`/`tileY` on the bundle reflect the nearest integer while moving, snapping to exact target on arrival.
- **Selection ring:** `THREE.RingGeometry(0.32, 0.42, 32)` rotated flat, emissive cyan, just above tile plane (`y = 0.01`). Lives as `selectionRing` child of the worker group. `selectWorker(null)` hides the previous ring before showing the new one — no ring leaks possible.
- **Raycasting against workers:** `raycastWorker` in `scene.ts` collects all `THREE.Mesh` descendants of each worker group, intersects them, then walks `.parent` chain to find which `WorkerBundle` owns the hit. This handles the nested group structure (diamond group inside top-level group). Click in `main.ts` runs `raycastWorker` first; if it hits a blue worker, select it. If red, deselect. If no worker hit, check tile plane — move selected worker or deselect on off-grid.
- **Hook API changes:** `spawnWorker`, `moveWorker` on the e2e-hook (requires `?e2e=1`); `getWorkerTile` exposed on the debug hook in dev mode always (no `?e2e=1` needed). Old placeholder worker/raider cubes in `seedEarlyEconomy` / `seedIdleStart` replaced with `buildWorker` calls on real starter workers.
- **Caveats:** Workers pass through each other — no collision detection. Fine for MVP; flag for `worker-harvesting` or `combat` task. The `pointerdown` worker-click handler added to canvas in `main.ts` runs alongside the placement-mode handler in `input.ts`; idle-mode guard (`state.mode !== 'idle'`) prevents interference when placement mode is active.

Commit SHA: (see below after git commit)

Screenshots regenerated: `pm/screenshots/idle-start.png` (4 starter workers visible), `pm/screenshots/early-economy.png`, `pm/screenshots/mid-combat.png`.
