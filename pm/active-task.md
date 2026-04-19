---
id: scene-runner
opened_at: 2026-04-19T03:50:40Z
status: done_by_engineer
priority: P0
---

# Playwright scene-runner producing pm/screenshots/*.png

## Outcome
The PM gains eyes on the game. A Playwright scene-runner renders the three scenes
named in `pm/rubric.md` (`idle-start`, `early-economy`, `mid-combat`) against the
actual Three.js scene in the running dev/preview server and writes deterministic
PNGs to `pm/screenshots/<scene>.png`. These screenshots are committed to `main`
so the PM can score them against the rubric on the next tick.

Without this, the PM is blind and cannot do visual evaluation. No gameplay
changes are in scope — we only need reproducible scene captures of the current
visual state, plus test-only hooks that let future scenes exercise game state
that does not yet exist.

## Acceptance
- Under `tests/e2e/scenes/` there is one Playwright spec per scene named to
  match `pm/rubric.md` (`idle-start.spec.ts`, `early-economy.spec.ts`,
  `mid-combat.spec.ts`).
- Each spec navigates the app, waits for the Three.js canvas to render a stable
  frame, and captures a PNG to `pm/screenshots/<scene>.png` at a fixed viewport
  size (default 1280×800 is fine — pick one and stick to it).
- The scene-runner uses a **test-only window hook** (e.g. `window.__vylux`) that
  is only installed when a query param like `?e2e=1` is present, so production
  builds do not leak test affordances. The hook exposes at minimum:
    - `setScene(name)` — mutates scene state into the requested preset. For
      scenes whose underlying gameplay doesn't exist yet (workers, raiders),
      seed placeholder meshes at the correct positions / colours so the scene
      is *visually* representative even if not functionally real.
    - `ready()` — resolves when the next frame has rendered.
- A single command (e.g. `npm run scenes` or `pnpm scenes`) runs all three
  specs in headed-or-headless mode and updates the PNGs. Document it in
  `pm/README.md` under a "Refreshing screenshots" section (append, don't rewrite).
- Committed artefacts: the three PNGs under `pm/screenshots/`, the three specs,
  the Playwright config update if any, the window hook code, and the npm
  script wiring. Do **not** commit any screenshots with transparent or zero-byte
  output — verify they're valid PNGs locally before committing.
- Running the verify command (lint + type + unit + the new scene specs) passes
  cleanly on `main` before commit.

## Constraints
- Do not modify `pm/mvp.md`, `pm/persona.md`, `pm/rubric.md`, or
  `pm/backlog.yaml` — those are PM-owned.
- Do not alter existing gameplay code paths beyond what's needed to install the
  `?e2e=1`-gated window hook. Specifically, leave `src/placement.ts`'s
  state-machine shape intact if it exists.
- Placeholder meshes for not-yet-implemented units are fine **for screenshots
  only** — don't hack them into the main render loop permanently. Prefer
  seeding them through the test hook.
- Keep the viewport deterministic: same size, same camera, same seed. Flaky
  screenshots are worse than no screenshots.
- No `git push`. Commit to local `main` only.

## Handoff

- Added `src/e2e-hook.ts`: a `?e2e=1`-gated hook that installs `window.__vylux.setScene(name)` and `window.__vylux.ready()`. Placeholder meshes (HQs, workers, raiders, energy nodes) are seeded directly into a dedicated `e2e-overlays` Three.js group — no placement state mutation.
- Added three Playwright specs under `tests/e2e/scenes/`: `idle-start.spec.ts`, `early-economy.spec.ts`, `mid-combat.spec.ts`. Each navigates to `/?e2e=1`, calls `setScene`, awaits `ready`, and writes a 1280×800 PNG.
- Updated `playwright.config.ts` with a `scenes` project matching `scenes/*.spec.ts` against the dev server.
- Added `npm run scenes` script (`playwright test --project=scenes`) to `package.json`.
- Appended "Refreshing screenshots" section to `pm/README.md`.
- All 19 E2E tests pass (16 existing + 3 new scenes); typecheck and unit tests clean.

Commit SHA: 75bfca4

Caveats:
- HQ meshes are box geometries with neon edge trim — placeholder. Replace with a distinct Tron-style silhouette when the HQ task lands.
- Energy nodes are spheres with strong green emissive — placeholder. Replace when the energy-node task lands.
- Workers and raiders are differentiated only by box size — no distinct silhouette yet.
