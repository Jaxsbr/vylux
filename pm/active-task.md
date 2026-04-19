---
id: visual-tune-pass-1
opened_at: 2026-04-19T04:14:58Z
priority: P0
status: done_by_engineer
---

# Visual tuning pass 1 — camera framing + bloom threshold

## Outcome
Two knob-turns, no new gameplay code. Together they unblock the two
per-axis rubric failures that are not a palette problem:

- **Camera framing**: the grid currently occupies ~30 % of the 1280×800 frame
  with vast charcoal space around it. Zoom/re-aim the isometric camera so the
  **grid plus HQ halos fills ≥ 70 %** of the frame in the `idle-start`
  screenshot, with no HQ clipping at the top/bottom edges. This moves
  `grid_presence` from 5 → 7+.
- **Bloom threshold**: `UnrealBloomPass` is currently running at threshold 0 /
  strength 1.2, which blows the HQ's 4-tier silhouette into an amorphous neon
  cloud. Raise `threshold` and trim `strength` until the **tier edges are
  visibly readable at distance while the faction glow still haloes**. Target:
  silhouette tiers distinguishable in the committed `idle-start.png`. This
  moves `silhouette` from 3 → 6+.

No new meshes. No new modules. No new tasks — just tuning.

## Acceptance
- `src/scene.ts` camera configuration updated: zoom factor / orthographic
  frustum / perspective FOV (whichever the current camera uses) adjusted so
  the isometric grid + both HQs with their bloom halos fill ≥ ~70 % of the
  1280×800 `idle-start` viewport without clipping. HQs remain at grid
  `(0,0)` and `(19,19)`.
- `UnrealBloomPass` parameters updated: `threshold` raised from 0 toward
  somewhere in the 0.4 – 0.8 range, `strength` tuned alongside (somewhere
  0.6 – 1.0 is likely right, but pick by eye). Radius may also be tuned.
  All three values live in one place with one short comment line explaining
  the tuning goal — not five. Parameter choice is yours; the gate is what
  the screenshot shows.
- Regenerate and commit `pm/screenshots/{idle-start,early-economy,mid-combat}.png`
  via `npm run scenes`. Each must visibly:
    - Show the grid dominating the frame (not a small diamond in the middle).
    - Show the HQ tiers as distinct silhouette steps, not smooth blobs.
    - Keep the HUD in its existing top-left / top-center positions — if the
      HUD collides with the enlarged scene, adjust HUD positions only as
      needed to avoid overlap with the grid or HQs; do not restyle the HUD.
- The three scene specs continue to pass without loosening assertions. If an
  assertion needs to change because the camera changed, fix it deliberately
  and note it in the Handoff.
- Verify passes (lint + type + unit + all Playwright projects). Commit to
  local `main`.

## Constraints
- Do **not** touch `pm/mvp.md`, `pm/persona.md`, `pm/rubric.md`, or
  `pm/backlog.yaml` — PM-owned.
- Do not rework HQs, HUD styling, energy nodes, workers, raiders, or any
  gameplay code. Scope is camera params + bloom params only.
- Do not add a new post-processing pass (no SSAO, no FXAA, no vignette).
- Do not remove or gate the `?e2e=1` hook; real game + E2E scenes must
  share the same camera/bloom settings.
- No `git push`.

## Handoff

- **Camera**: `viewSize` reduced 12 → 10 in `SCENE_CONSTANTS` (orthographic frustum). Grid + HQ halos now fill ~85-90% of the 1280×800 frame. No other camera params changed (yaw=45, elevation=30, lookAt origin preserved — all foundation assertions still pass).
- **Bloom**: `bloomThreshold` 0 → 0.45, `bloomStrength` 1.2 → 0.8, `bloomRadius` 0.7 → 0.6. HQ tier silhouettes (especially Red at bottom of diamond) now visibly stepped rather than smooth blobs. Single comment line explains the tuning target.
- **No spec changes**: all 19 Playwright tests pass unchanged (no assertions depend on bloom values or viewSize).
- **Screenshots regenerated**: `pm/screenshots/{idle-start,early-economy,mid-combat}.png` committed.
- **Visual caveat**: Blue HQ glow at top of diamond sits behind the Points HUD panel (DOM on top of canvas) — no geometric clip, but the glow halo radiates through/around the panel. HUD positions left unchanged per constraints; mid-combat still sparse (no real unit silhouettes beyond box meshes).

Commit SHA: c2180bb
