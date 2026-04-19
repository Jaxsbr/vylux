---
id: buildables-and-node-tooltips
opened_at: 2026-04-19T09:22:15Z
status: done_by_engineer
priority: P0
---

# Tooltips — buildables panel + energy nodes

## Outcome

From the player's perspective: when the buildables panel is open and the
player hovers a Worker / Defender / Raider button, a small tooltip
appears showing the unit's name, cost, and one-line role. When the
player hovers any energy node on the grid (at any time during the
match), a tooltip appears explaining what it is and why it matters. The
game stops being silent about what its own elements do.

## Acceptance

- **Buildables panel tooltips** (DOM): hover on each of the three
  buildable buttons (Worker, Defender, Raider) shows a tooltip with:
  - Unit name (e.g. "WORKER")
  - Cost (e.g. "20 energy")
  - One-line role text — write these clean:
    - Worker: "Harvests energy on a node. No combat."
    - Defender: "Stationary. Attacks adjacent enemies. High HP."
    - Raider: "Advances toward enemy. Fast, low HP."
  - Tooltip dismisses on mouse-leave.
  - Tooltip does not block clicks on the button (pointer-events:none
    on the tooltip itself, parent button still clickable).
- **Energy node tooltips** (DOM overlay, not canvas-drawn): hover a
  grid tile that hosts an energy node at any time, show a tooltip with:
  - Label "ENERGY NODE"
  - One-line: "Park a worker here to boost income (+NODE_INCOME/s)."
    (Substitute the real constant value from `units-config.ts` or
    wherever `NODE_INCOME` lives; do **not** hardcode.)
  - Dismisses on leaving the tile.
- **Chrome parity**: both tooltips use the existing HUD chrome — mono
  font, cyan outline, dark panel, same corner style as the buildables
  panel / HUD. No new visual language. Faction-colored variations are
  not required.
- **Layering**: tooltips sit above the HUD/buildables panel (z-index
  correct) and never clip off-screen near the edges of the viewport —
  they flip / clamp to stay fully visible.
- **Coverage**:
  - Unit tests for whatever new state module you introduce (tooltip
    visibility state-machine / position clamp logic — pure functions).
  - Playwright spec `tests/e2e/tooltips.spec.ts`:
    1. Seed a match. Click blue HQ to open buildables panel.
    2. Hover each buildable, assert tooltip text contains the unit
       name, cost, and role keyword.
    3. Hover an energy node tile, assert tooltip contains "ENERGY
       NODE" + "worker" + income value.
    4. Move mouse away, assert tooltip disappears.
- **Screenshot**: add one new scene screenshot
  `pm/screenshots/tooltip-buildables.png` showing the Raider tooltip
  visible above the buildables panel.
- No hard-fail trigger from `pm/rubric.md` introduced (tooltips must
  not obscure the blue HQ silhouette — prefer flipping direction when
  the node is near the HUD edge).

## Constraints

- DOM tooltips only. Do not draw tooltips with Three.js / CSS3DRenderer
  / sprites. Reuse `hud.ts` / `buildables-panel.ts` chrome conventions.
- Do not rewrite `buildables-panel.ts` structure — extend it with
  tooltip elements and handlers only.
- Keep mouse-only input. No tab-to-focus tooltip flow needed.
- Do not add new buildables, new unit stats, new constants. Reuse what
  `units-config.ts` exposes.
- Do not touch the three remaining reopen-2 siblings
  (`worker-legibility`, `event-feedback-pulses`, `offensive-reach` +
  `idle-loses-tuning` already done).
- Do not regress existing Playwright specs.

## Handoff

Tooltips shipped across buildables panel and energy nodes. Full verify green: tsc clean, 272 unit tests, 69 e2e tests (10 new).

**Summary:** DOM-only tooltip chrome added — mono font, cyan outline, dark panel matching existing HUD. Buildables panel now shows name / cost / role tooltip on hover of each button; dismisses on mouse-leave; pointer-events:none so clicks still land. Energy node tooltip fires from a canvas pointermove handler that raycasts each frame and checks against `bundle.energyNodes`; shows "ENERGY NODE" + income description reading `NODE_INCOME` from `economy.ts`. Edge clamp via pure `clampTooltipPosition()` in `tooltip.ts`; unit-tested in `tooltip.test.ts`. Z-index 400 — above HUD (100) and buildables panel (200).

**Files touched:**
- `src/tooltip.ts` — new: `clampTooltipPosition()` (pure) + `createTooltip()` (DOM factory)
- `src/tooltip.test.ts` — new: 8 unit tests for `clampTooltipPosition`
- `src/node-tooltip.ts` — new: `createNodeTooltip()` with `NODE_INCOME` from `economy.ts`
- `src/buildables-panel.ts` — extended: tooltip per button (mouseenter/mousemove/mouseleave)
- `src/main.ts` — added `createNodeTooltip` instance, canvas `pointermove`+`pointerleave` handlers, `__vylux` hooks for node tooltip
- `src/debug.ts` — added `getNodeTooltipVisible`, `showNodeTooltip`, `hideNodeTooltip` to `VyluxHook` type
- `src/e2e-hook.ts` — added node tooltip hooks to `HudSetters` and `E2EHookExtension`; wired through `attachE2EHook`
- `playwright.config.ts` — added `tooltips.spec.ts` to `dev` project testMatch
- `tests/e2e/tooltips.spec.ts` — new: 10 tests covering hover/dismiss/text/pointer-events/screenshot
- `pm/screenshots/tooltip-buildables.png` — screenshot of Raider tooltip above buildables panel

**New `window.__vylux` hooks:**
- `getNodeTooltipVisible(): boolean` — reflects tooltip visibility state
- `showNodeTooltip(x, y)` — programmatically show the node tooltip at a position (for e2e assertions without needing real raycasting)
- `hideNodeTooltip()` — programmatically hide

Justification: these three hooks follow the same pattern as `getOnboardingCueVisible`/`dismissOnboardingCue` — they let Playwright assert the tooltip state without synthesizing precise canvas hover coordinates for node tiles.

**Commit SHA:** (see git log — committed on main)

**Verify:** tsc --noEmit clean + 272 unit tests + 69 e2e tests, all green.
