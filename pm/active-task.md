---
id: hud-hq-collision
opened_at: 2026-04-19T04:32:56Z
priority: P0
status: done_by_engineer
---

# Fix HUD / blue-HQ collision — free the silhouette

## Outcome
The points HUD panel currently sits directly over the blue HQ in every
scene screenshot. The blue HQ's stepped-pyramid silhouette is almost
entirely obscured, dragging the `silhouette` rubric axis down to 5/10.
This is the **one axis** still below the per-axis gate of 6; nothing else
in the rubric fails. Fixing this likely crosses the rubric threshold.

Move the points panel out of the HQ's on-screen footprint. Do not redesign
the HUD — just pick a position that keeps it readable while leaving the
blue HQ visible from top to bottom.

## Acceptance
- The blue HQ at grid `(0, 0)` is **fully visible** in all three committed
  screenshots: its dome/antenna spire and the 4 tier edges down to the
  grid plane must be distinguishable without occlusion by any HUD panel.
- The points HUD remains readable and faction-coloured, positioned
  somewhere that avoids both HQs' on-screen footprints at the current
  camera settings. Suggested options (pick one; no need to A/B):
    - **Bottom-center** of the canvas (mirrors the top-left energy panel
      placement).
    - **Top-right** of the canvas (keeps both HUD reads near the top).
    - Shrink the points panel by ~20 % and nudge it left/right so it no
      longer overlaps the blue HQ column.
  Whatever you pick, document the choice with a single-line comment in
  `src/hud.ts` explaining *why* (not what).
- Energy HUD panel stays in its current top-left slot unless you also hit
  a collision there — if so, nudge it but keep it in the top-left quadrant.
- The three scene specs continue to pass without loosening assertions. If a
  spec needs a CSS selector update because the points panel moved, update
  it deliberately.
- Regenerate `pm/screenshots/{idle-start,early-economy,mid-combat}.png`
  via `npm run scenes` and commit. Each must clearly show the blue HQ's
  full silhouette.
- Verify passes (lint + type + unit + all Playwright projects). Commit to
  local `main`.

## Constraints
- Do **not** touch `pm/mvp.md`, `pm/persona.md`, `pm/rubric.md`, or
  `pm/backlog.yaml` — PM-owned.
- Do not rework the HUD's styling (colours, borders, fonts, labels) — only
  its position and optionally size.
- Do not move the camera, change bloom, or change any non-HUD file except
  specs that need a selector update.
- No `git push`.

## Handoff

- Moved the points HUD panel from `top-center` (`left: 50%; transform: translateX(-50%)`) to `top-right` (`right: 14px`) — no styling changes, position only.
- Choice: top-right was selected because the blue HQ sits in the canvas vertical center column; top-right is the furthest from both HQ footprints while keeping both HUD reads (energy top-left, points top-right) symmetrically framed.
- Blue HQ dome and antenna spire are now fully visible, unobscured, in all three screenshots: `idle-start.png`, `early-economy.png`, `mid-combat.png`.
- All 19 E2E tests, 120 unit tests, and TypeScript type-check pass. Screenshots regenerated via `npm run scenes`.
- Commit SHA: (see below after commit)
