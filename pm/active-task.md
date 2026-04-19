---
task_id: visual-concept-match-pass
priority: P0
status: done_by_engineer
dispatched_at: 2026-04-19T07:27:36Z
dispatched_tick: CC34AE75
mvp_link: "pm/mvp.md — acceptance item 'Visual concept-match'"
inbox_link: "pm/inbox/2026-04-19-mvp-failure.md"
rubric_link: "pm/rubric.md v2 — threshold 48/7, hard-fails include 'units read as full-saturation glowing cubes with no dark core'"
---

# Visual concept-match pass — dark silhouettes, accented neon (not glowing cubes)

## Why this task

Owner (Jaco) reviewed the first MVP pass and rejected the visual
direction even though the PM's rubric v1 scored it at 50/35:

> "The placeholder 'guidance' units spawned via keys 1/2 were meant to
> be the visual baseline: accented neon on a dark silhouette, not
> full-saturation neon. Current units are uniformly over-lit and read
> as flat glowing cubes, not Tron units."

The rubric was tightened to v2 (threshold 48, per-axis 7, hard-fails
rejecting full-saturation cubes and missing-cue scenes, glow/silhouette
axes rewritten). This task is the engineer response: rework materials
and bloom so the scene passes rubric v2 against the concept PNGs.

## Reference

Open each of these and study them side-by-side with the current
screenshots before touching any material:

- `docs/concepts/Isometric_3D_real-time_strategy_game_screenshot_Tron-inspired_9f371fa3-921d-4540-84e9-165734ff064b_0.png`
- `docs/concepts/Isometric_3D_real-time_strategy_game_screenshot_Tron-inspired_9f371fa3-921d-4540-84e9-165734ff064b_1.png`
- `docs/concepts/Isometric_3D_real-time_strategy_game_screenshot_Tron-inspired_9f371fa3-921d-4540-84e9-165734ff064b_2.png`

Against:

- `pm/screenshots/idle-start.png`
- `pm/screenshots/early-economy.png`
- `pm/screenshots/mid-combat.png`

The concept look: dark bodies (near-black, mostly matte) with thin
luminous edges and a small number of glowing accents. Halos exist but
do not obliterate the silhouette. Our current look: faces uniformly
emissive + strong bloom, so the dark body disappears and the whole
mesh reads as a saturated cube.

## Scope

### In scope

1. **Drop face emissive on faction meshes (HQ, worker, defender,
   raider). Keep edges bright.**
   - `src/hq.ts` currently has `emissiveIntensity: 1.4` on the body.
     Drop it. The body should read dark; only the `EdgesGeometry` trim
     and a small number of accent features (e.g. the spire tip,
     antenna, or a thin accent strip) glow.
   - Same treatment for `src/worker.ts` (currently 1.2), `src/defender.ts`,
     `src/raider.ts`. Keep edge lines at full faction colour;
     drop the face.
   - The approach can be: `MeshStandardMaterial` with `emissiveIntensity`
     near 0 on the body + separate glowing edge + an accent mesh (small
     strip / cap / trim piece) that keeps the emissive. Whatever
     pattern you pick, apply it consistently across the four mesh
     modules.

2. **Tune bloom.**
   - `src/scene.ts` SCENE_CONSTANTS has `bloomStrength: 0.8`,
     `bloomRadius: 0.6`, `bloomThreshold: 0.45`. With accent emissive
     dropped, bloom may need its threshold *lowered* so the thin
     accents still halo, and its strength *reduced* so halos don't wash
     the silhouette. Tune by iteration — regenerate screenshots and
     compare to concept art.

3. **Preserve faction contrast.**
   - Blue vs red must still read instantly. If dropping face emissive
     makes factions look similar, strengthen the edge contrast (e.g.
     red-orange edges thicker or a single brighter accent) rather than
     re-introducing full-face emissive.

4. **Regenerate screenshots.**
   - Run the scene runner (Playwright `scenes` project) to regenerate
     `pm/screenshots/{idle-start,early-economy,mid-combat}.png`.
   - Commit the updated screenshots.

5. **Tests.**
   - Existing unit tests must still pass (mesh module tests, if any,
     may need constant updates — adjust assertions, don't remove
     coverage).
   - Existing e2e tests must still pass.
   - No new tests are required purely for the visual rework, but if
     you introduce a new helper (e.g. `buildAccentStrip`), unit-test
     it.

### Out of scope

- New unit types.
- Animations.
- Mesh replacements — stick with the existing geometry structure
  (tiered HQ, diamond worker, defender, raider). Tune materials and
  add small accent meshes only.
- Gameplay changes.
- Rewriting combat/economy/ai/match/points/node-points.
- Further rubric changes.

## Constraints

- **Do not re-raise threshold to hide the look.** The PM owns the
  rubric; the engineer ships what the rubric requires. If you think
  v2 is wrong, write a `pm/learnings/eng-<date>-rubric-feedback.md`
  note and flag it in the handoff; do not edit `pm/rubric.md`.
- **Do not obscure the blue HQ** with any new accent or halo (rubric
  v2 hard-fail).
- No new external dependencies.
- Palette stays: charcoal background, cyan `#00e0ff` (blue),
  red-orange `#ff4a1a` (red). No new hues.

## Acceptance

- [ ] Face emissive on HQ / worker / defender / raider is near-zero;
      neon comes from edges + small accents.
- [ ] Bloom tuned so halos read on edges but do not wash silhouettes.
- [ ] `pm/screenshots/idle-start.png`, `early-economy.png`,
      `mid-combat.png` regenerated and visibly closer to
      `docs/concepts/*.png`: dark bodies, thin neon trim, readable
      unit shapes.
- [ ] Onboarding cue still visible in `idle-start.png`.
- [ ] Blue HQ not obscured by any panel or halo.
- [ ] `npm run test` and `npm run test:e2e` pass.
- [ ] Commit locally with `feat(visuals): concept-match pass …` or
      equivalent. Do NOT push.

## PM visual-eval (follows this task, not part of it)

After you commit and fill in handoff, the PM will score the new
screenshots against `pm/rubric.md` v2. If total ≥ 48 and every axis
≥ 7 and no hard-fail triggers, `visual-concept-match` MVP item flips
to `[x]`. If it falls short, the PM files follow-up notes and queues
another tune pass.

## Handoff

**status: done_by_engineer**

### Commit

`264bfe2`

### Files touched

- `src/hq.ts` — dropped body `emissiveIntensity` from 1.4 → 0.05; added `buildAccentCap()` (thin bright strip at mid/spire junction, `emissiveIntensity: 2.0`).
- `src/worker.ts` — dropped body `emissiveIntensity` from 1.2 → 0.05; added equatorial accent ring (`emissiveIntensity: 2.0`).
- `src/defender.ts` — dropped body `emissiveIntensity` from 1.2 → 0.05; added waist accent strip (`emissiveIntensity: 2.0`).
- `src/raider.ts` — dropped body `emissiveIntensity` from 1.2 → 0.05; added spike-tip accent sphere (`emissiveIntensity: 2.0`).
- `src/scene.ts` — bloom tuned: `bloomStrength` 0.8→0.45, `bloomRadius` 0.6→0.5, `bloomThreshold` 0.45→0.25.
- `src/hq.test.ts` — updated the `emissiveIntensity >= 1.0` assertion to the correct two-part contract: body < 0.2 (dark silhouette), accent cap >= 1.5 (bloom source).
- `pm/screenshots/idle-start.png` — regenerated.
- `pm/screenshots/early-economy.png` — regenerated.
- `pm/screenshots/mid-combat.png` — regenerated.

### What changed visually

Units now read as dark near-black silhouettes with thin neon edge lines (EdgesGeometry, unchanged) and a small bright accent feature per unit type. Bloom halos the accent and edges only — the body mass stays dark. Faction contrast (blue cyan vs red-orange) preserved at full saturation on edges and accents.

### Acceptance checklist status

- [x] Face emissive on HQ / worker / defender / raider is near-zero (0.05).
- [x] Bloom tuned: threshold lowered to 0.25 so thin edges/accents still halo; strength 0.45 so halos don't wash silhouettes.
- [x] Screenshots regenerated — dark bodies, thin neon trim, readable unit shapes.
- [x] Onboarding cue ("CLICK YOUR HQ TO BEGIN") visible in idle-start.
- [x] Blue HQ not obscured.
- [x] `npm run test` 251/251 green. `npm run test:e2e` 56/56 green.

### Deviations

None. All acceptance items met.

### Follow-ups

None required. Scene density (unit count visible) in mid-combat is still limited by the AI build order — this is a separate issue from visual material quality and is not in scope for this pass.

### Rubric feedback

No rubric issues to flag. The v2 rubric requirements (dark core, edge-lit neon, no full-saturation cubes) are now correctly implemented.
