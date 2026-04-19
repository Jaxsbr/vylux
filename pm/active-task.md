---
id: hq-building
opened_at: 2026-04-19T03:58:58Z
status: done_by_engineer
priority: P0
---

# Real HQ buildings — Tron-silhouette, emissive, bloom-lit

## Outcome
The blue HQ (bottom-left corner of the grid) and red HQ (top-right corner) stop
reading as wireframe cubes and start reading as **Tron-style buildings**:
a distinct angular silhouette with chamfered edges / stacked tiers / vertical
"antenna" spine, strong emissive faction colour (cyan `#00e0ff` and red-orange
`#ff4a1a`), visible outer outline, and the whole scene picks up a real
post-processing **bloom pass** so emissive surfaces halo properly on the dark
charcoal ground.

When this task lands, the `idle-start` screenshot alone should show: two
recognisable neon buildings at opposite corners of a visibly-Tron grid, with
bloom halos pulling the eye. It unlocks the `silhouette`, `glow`, and
`composition` rubric axes in one move and sets the visual language the worker
/ raider meshes will inherit next.

## Acceptance
- A real `HQ` mesh class (module — name it sensibly, e.g. `src/hq.ts`) that
  produces a faction-coloured HQ at a given grid coordinate. Geometry must be
  more than a plain box:
    - Multi-tier stacked silhouette (e.g. wide base → narrower mid → thin
      spire), OR a chamfered prism with beveled edges. Either reads as
      "building", not "cube".
    - Visible neon outline along key edges (EdgesGeometry + LineSegments with
      the emissive faction colour works; pick what looks best).
    - Emissive material for the body with emissive intensity ≥ 1.0 so it
      glows under bloom.
- Blue HQ is placed at grid `(0, 0)`, red HQ at grid `(GRID_SIZE-1, GRID_SIZE-1)`
  (use the constants from `pm/mvp.md` — `GRID_SIZE = 20`). HQs appear in the
  real game path, not only via the `?e2e=1` hook.
- A **bloom post-processing pass** is wired into the main render loop using
  Three.js `EffectComposer` + `UnrealBloomPass` (or equivalent). Tune so
  emissive cyan / red-orange haloes are clearly visible but don't blow out
  the grid lines. Threshold/strength/radius live in one place and are
  documented with a one-line comment only if the chosen values are
  non-obvious.
- The test-only `window.__vylux.setScene` hook is updated so the `idle-start`,
  `early-economy`, and `mid-combat` scenes use the **real** HQ meshes (not the
  placeholder boxes from `src/e2e-hook.ts`). Worker/raider placeholders can
  stay boxes — that's a later task.
- `pm/screenshots/idle-start.png`, `early-economy.png`, `mid-combat.png` are
  regenerated via `npm run scenes` and committed. They must visibly show:
    - Two distinct HQ silhouettes at opposite corners (not cubes).
    - Bloom halos on the HQs.
    - The existing grid still renders; the HQs do not obscure it entirely.
- Verify passes (lint + type + unit + all Playwright projects including
  `scenes`). Commit to local `main`.

## Constraints
- Do **not** touch `pm/mvp.md`, `pm/persona.md`, `pm/rubric.md`, or
  `pm/backlog.yaml` — PM-owned.
- Keep the placement state-machine shape in `src/placement.ts` intact if it
  exists; HQs are pre-placed fixtures, not player placements.
- Leave the `?e2e=1` gate behaviour intact — production builds must still not
  install the test hook.
- Do not address energy nodes, HUD, or workers in this task. Scope is HQ
  silhouette + bloom only. Resist scope creep — even if the fix is one line,
  defer.
- No new runtime dependencies unless absolutely necessary. Three.js ships
  `EffectComposer` + `UnrealBloomPass` in its `examples/jsm/postprocessing/`
  path — use those.
- No `git push`.

## Handoff

- `src/hq.ts` — new module: `buildHQ(faction, tileX, tileY)` produces a 4-tier angular silhouette (base → mid → spire → antenna) with emissive body (intensity 1.4) and `EdgesGeometry` neon trim in faction colour; no plain box.
- `src/scene.ts` — `createScene()` now pre-places blue HQ at (0,0) and red HQ at (19,19) in the real game path (always visible, not e2e-gated). Bloom strength bumped to 1.2 / radius 0.7 so emissive halos are clearly visible on dark background.
- `src/e2e-hook.ts` — removed placeholder HQ boxes from `seedIdleStart`; HQs come from `createScene()` in all three scenes. Energy-node and worker/raider placeholders unchanged.
- `src/hq.test.ts` — 9 unit tests covering group name, tier count, Mesh+LineSegments per tier, emissive colour by faction, emissive intensity >= 1.0, and world position correctness.
- Screenshots `pm/screenshots/{idle-start,early-economy,mid-combat}.png` regenerated — two distinct multi-tier neon silhouettes visible at opposite grid corners with bloom halos.
- Commit SHA: `32a70ec`
- Visual caveat: bloom threshold stays at 0 (any bright pixel halos); energy nodes are still green spheres — palette axis will only fully clear once nodes are reworked in a later task.
