---
id: node-control-points
opened_at: 2026-04-19T05:17:20Z
priority: P0
status: done_by_engineer
---

# Node-control points — 1 pt/sec per held energy node

## Outcome
Energy nodes aren't just economy anymore — they score points. A faction
"holds" a node whenever at least one of its workers stands on that tile and
no enemy worker is on it. While held, the node ticks **+1 point/second** to
the holder via the existing `points` ledger. This closes the third accrual
rule for the `Point system` MVP item (kill + HQ-damage already landed in
`combat`). When this ships, a worker parked on a node visibly pushes its
faction's point counter upward in the HUD.

## Acceptance
- New module `src/node-points.ts` (pure where possible, side-effectful where
  necessary). Expose:
    - `tickNodePoints({ nodes, units, pointsLedger, dt })` — walks every
      node, determines its holder via the same rule already used for
      `setFactionHold` (blue worker on tile, no red; red worker on tile, no
      blue; contested or empty → no holder), and accrues `NODE_POINT_RATE *
      dt` to the holder's faction using a **fractional accumulator** on the
      node bundle so no fractional-second rounding loss occurs.
    - Add `NODE_POINT_RATE = 1` (pt/sec) alongside `NODE_INCOME` in the
      config it naturally lives next to (extend existing config — do not
      create a new one-constant file).
- Reuse, don't duplicate, the node-hold detection. If `setFactionHold` is
  currently decided inside `main.ts` or a scene helper, extract a pure
  `computeNodeHolder(node, units): 'blue' | 'red' | null` and call it from
  both the render-side (for emissive glow) and the new `tickNodePoints`
  loop. Zero gameplay behavioural change around hold colouring.
- Energy-node bundle in `src/energy-node.ts` gains:
    - `pointAccumulator: number` (defaults 0, clamped on overflow).
    - No new visual element required for MVP. (Optional: if it's trivial,
      you may scale the hold glow slightly by accumulated time — skip if
      it adds complexity.)
- `src/points.ts`:
    - Nothing new to add — `addPoints(faction, amount)` from combat already
      exists. Accrue whole points only: emit from the accumulator each time
      it crosses ≥ 1 (e.g. `while (acc >= 1) { addPoints(faction, 1); acc -= 1 }`)
      so the visible counter moves in integer steps and tests are easy.
- Main-loop integration:
    - `src/main.ts` calls `tickNodePoints(...)` each frame after
      `tickCombat(...)` with the current nodes + units + points ledger +
      `dt`. Same cadence as economy/combat.
- Test-only hook additions:
    - `window.__vylux.getNodePointAccumulator(nodeIndex)` — returns the
      current fractional accumulator so specs can assert progress without
      waiting whole seconds.
    - Optional: `window.__vylux.tickNodePointsOnce(dt)` if it makes specs
      cleaner; otherwise rely on `advanceTime` that combat already shipped.
- Unit tests (`src/node-points.test.ts`):
    - Uncontested blue worker on a node for 1.0 s of simulated time → blue
      faction gains exactly 1 point.
    - Contested node (one blue + one red worker on the same tile) → neither
      faction accrues.
    - Empty node → no faction accrues.
    - Holder switching mid-tick resets behaviour: a node that flips from
      blue to red should NOT transfer the blue accumulator to red — the
      accumulator zeroes on holder change.
    - Multiple held nodes accrue independently.
- Playwright coverage: new spec `tests/e2e/node-points.spec.ts`:
    - Start clean. Use hooks to park a blue worker on a specific node and
      ensure no red worker is adjacent.
    - `advanceTime(3.0)` simulated seconds.
    - Assert `getPoints('blue') >= 3` and `getPoints('red') === 0`.
- Scene spec updates:
    - `early-economy` — after its existing setup, call
      `advanceTime(2.0)` so the HUD point counters show a small non-zero
      blue value on that screenshot. Proves node-control points are live
      without needing a dedicated scene. Red counter may remain near 0.
    - `idle-start` and `mid-combat` — no changes required.
- Regenerate `pm/screenshots/{idle-start,early-economy,mid-combat}.png`
  via `npm run scenes` and commit. `early-economy.png` should show a small
  positive blue point total in the HUD.
- Verify passes (lint + type + unit + all Playwright projects). Commit to
  local `main`.

## Constraints
- Do **not** touch `pm/mvp.md`, `pm/persona.md`, `pm/rubric.md`, or
  `pm/backlog.yaml` — PM-owned.
- Do not implement: AI opponent, win/lose screen, node capture progress
  bars, node ownership timers beyond the simple accumulator described
  above.
- Do not introduce a new ECS or state-management framework. Keep the
  arrays-on-scene pattern.
- Contested = at least one worker of each faction on the tile. Keep the
  detection rule identical to the one that already drives `setFactionHold`.
- No `git push`.

## Handoff

**Commit SHA:** f89a34d

**Summary:** Shipped node-control scoring. New `src/node-points.ts` exports `computeNodeHolder` (pure, reused for both glow and scoring) and `tickNodePoints` (fractional accumulator, whole-point emission via existing `addPoints`). `NODE_POINT_RATE = 1` and `NODE_INCOME = 2` added to `economy.ts`. `EnergyNodeBundle` gains `pointAccumulator` and `lastHolder`. `main.ts` calls `tickNodePoints` + updates node glow from live unit positions each frame. `advanceTime` in `e2e-hook.ts` now also ticks node points. New hooks: `getNodePointAccumulator`, `getPoints`. Unit tests in `src/node-points.test.ts` (11 tests). New `tests/e2e/node-points.spec.ts` (2 tests). `early-economy.spec.ts` adds `advanceTime(2.0)` to show live point accrual in screenshot.

**Screenshots regenerated:** `pm/screenshots/idle-start.png`, `pm/screenshots/early-economy.png`, `pm/screenshots/mid-combat.png`

**Verify:** tsc + 203 unit tests + 34 e2e tests — all green.
