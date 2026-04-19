---
id: hud-energy-points
opened_at: 2026-04-19T04:07:07Z
status: done_by_engineer
priority: P0
---

# HUD — energy counters (top-left) + point totals (top-center)

## Outcome
Every screenshot from now on includes a **Tron-styled HUD overlay** with
faction-coloured panels:

- **Top-left**: `BLUE` and `RED` energy counters, updating from a single
  authoritative energy-ledger module. Both factions trickle at `BASE_INCOME`
  (1/s) unconditionally — no workers or nodes required yet.
- **Top-center**: `BLUE` and `RED` point totals, updating from a points-ledger
  module. For this task, points can stay at 0 (wiring placeholder — the
  point-accrual rules come later); the point panels must still render with
  their labels and zeroed counters.

HUD chrome echoes the neon grid: thin cyan outlined panel for blue, thin
red-orange outlined panel for red, charcoal fill, monospace font, small
uppercase labels. It must read as **part of the world**, not default browser
text floating on the canvas. This directly attacks the `ui_integration` rubric
axis (currently 0/10) and ticks two MVP checklist items (`Energy resource`
and `Point system`).

## Acceptance
- New `src/hud.ts` module (plus any small sibling files you want) that:
    - Exposes a `createHud({ onEnergyTick, onPointsTick })` or similar API
      used by the main render / tick loop. Design at your discretion — the
      constraint is that the HUD does not reach into game state; game state
      pushes updates to the HUD.
    - Renders as a DOM overlay (not canvas-texture) so text stays crisp and
      accessible. Use `position: absolute`, `pointer-events: none` on
      containers, and re-enable `pointer-events: auto` only on any
      interactive element (none required for this task).
    - Uses a monospace stack (`ui-monospace, "JetBrains Mono", "Fira Code",
      Menlo, monospace`) and uppercase labels.
    - Panels have 1px cyan (`#00e0ff`) or red-orange (`#ff4a1a`) outlined
      borders with a `drop-shadow` glow matching the faction colour, and a
      charcoal background (`rgba(10, 12, 16, 0.85)`).
- New `src/economy.ts` module (or equivalent) that owns per-faction energy
  state. Each tick it adds `BASE_INCOME / ticksPerSecond` to each faction's
  energy. Export a pure helper + a tickable instance; write unit tests that
  cover `BASE_INCOME` accrual over time and clamping to non-negative.
- New `src/points.ts` module (or equivalent) that owns per-faction point
  state. For this task the ledger just exists, stays at 0, and is wired into
  the HUD. Unit tests should cover the public API surface.
- `src/main.ts` / `src/scene.ts` (whichever owns the loop) creates the HUD
  once, creates the two ledgers, and on each render frame pushes the latest
  numbers into the HUD. Integer display; no trailing decimals.
- The test-only `window.__vylux` hook exposes setters the scene specs can use
  to force deterministic energy + points values (e.g.
  `window.__vylux.setEnergy({ blue: 42, red: 18 })` and
  `setPoints({ blue: 120, red: 60 })`). Each scene spec calls the setter
  before taking its screenshot so the numbers in the PNG are stable.
- The three existing scene specs update to seed meaningful HUD numbers:
    - `idle-start`: `energy: { blue: 0, red: 0 }`, `points: { blue: 0, red: 0 }`.
    - `early-economy`: `energy: { blue: 24, red: 17 }`, `points: { blue: 6, red: 4 }`.
    - `mid-combat`: `energy: { blue: 58, red: 43 }`, `points: { blue: 145, red: 132 }`.
- `pm/screenshots/{idle-start,early-economy,mid-combat}.png` regenerated via
  `npm run scenes` and committed. Each PNG must clearly show both HUD blocks
  with the numbers above rendered in the expected faction colours.
- Verify passes (lint + type + unit + all Playwright projects). Commit to
  local `main`.

## Constraints
- Do **not** touch `pm/mvp.md`, `pm/persona.md`, `pm/rubric.md`, or
  `pm/backlog.yaml` — PM-owned.
- Do not rework HQs, bloom, camera framing, or energy-node visuals in this
  task. Scope is HUD + ledgers only. If you spot a camera/framing issue, log
  it in the Handoff notes — do not fix it here.
- Do not introduce a UI framework (no React, no Vue, no Lit). Plain DOM /
  small helper functions only. Keep the dependency graph flat.
- HUD must still render under the `?e2e=1` scenes the same way it renders in
  the real app — do not gate it behind a flag.
- No `git push`.

## Handoff

- Added `src/economy.ts` (pure `tickEnergy`/`setEnergyValues` + `createEnergyLedger`) and `src/points.ts` (pure `setPointValues` + `createPointsLedger`); 21 unit tests cover accrual, clamping, partial patch, and immutability.
- Added `src/hud.ts`: DOM overlay with faction-coloured outlined panels (cyan/#00e0ff for blue, red-orange/#ff4a1a for red), charcoal fill, monospace stack, uppercase labels, `drop-shadow` glow — positioned top-left (energy) and top-center (points); `pointer-events: none` throughout.
- Updated `src/main.ts` to create the ledgers and HUD, push values each frame via `requestAnimationFrame` delta-time, and expose `setEnergy`/`setPoints` on `window.__vylux` for test control.
- Updated `src/e2e-hook.ts` to accept and forward `setEnergy`/`setPoints` into the E2E hook extension so scene specs can call them.
- Updated all three scene specs (`idle-start`, `early-economy`, `mid-combat`) to seed deterministic energy and point values before taking their screenshots; regenerated `pm/screenshots/{idle-start,early-economy,mid-combat}.png` via `npm run scenes`.
- Verify: `npx tsc --noEmit && npm run test && npm run test:e2e` — 109 unit tests + 19 E2E tests, all green.

Commit SHA: 90c25db

Follow-ups worth a dedicated task:
- Camera framing: grid occupies <1/3 of frame; HQ halos dominate centre — score notes this repeatedly. A camera zoom-out or grid-offset task would improve `grid_presence` and `composition` axes.
- Bloom threshold=0 / strength=1.2 blows HQ silhouettes into amorphous blobs — a bloom-tuning task targeting `silhouette` axis.
