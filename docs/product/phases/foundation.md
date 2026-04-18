# Phase: foundation

Status: draft

## Phase goal

Stand up the visual and interaction foundation for Vylux: a Three.js isometric scene with a 20x20 neon grid, keyboard-driven unit placement mode for two factions (blue / red), hover preview with ghost unit, left-click placement, and per-tile occupancy enforcement. No gameplay systems are in scope — this phase proves the rendering pipeline, the placement-mode state machine, and the faction visual identity. Output is a playable prototype a user can load, toggle into blue/red placement, preview hover, click to commit a unit, and repeat.

## Design direction

Tron-inspired neon on charcoal. Near-black scene background (`#0a0a0a`), faint emissive white grid lines on otherwise-invisible charcoal tiles, cyan neon for blue units, red-orange neon for red units. Hover tile colors dim to the selected faction's hue; ghost unit renders semi-transparent. Low ambient + single directional light so the emissive materials carry the read. Reference images live in `docs/concepts/*.png`. The build-loop must apply the frontend-design skill when implementing user-facing behavior.

Tron is chosen (not e.g. Starcraft isometric, not warm retro-CRT) because the brief's required two-faction split — blue vs. red-orange — is exactly the Tron palette, and because emissive-on-dark composites cleanly with per-tile state changes (hover, occupied, future territory). Documented faction hexes (source of truth for material assertions):

- Blue / cyan: `#00e5ff`
- Red-orange: `#ff5a1f`
- Dim blue (hover tile): `#0d4d57`
- Dim red-orange (hover tile): `#5a2311`
- Grid divider (emissive white): `#ffffff`, low intensity
- Scene background: `#0a0a0a`

## Tech stack (locked this phase)

- **Runtime:** browser, single-page app
- **Language:** TypeScript
- **Rendering:** `three` (latest stable) with `@types/three`
- **Build/dev:** Vite (chosen over hand-rolled `tsc --watch` + static server for single-command DX: `npm run dev` serves with HMR, `npm run build` produces a static bundle)
- **Entry:** `index.html` at project root, `src/main.ts` as the module entry
- **Testing:** Vitest for pure logic, Playwright for smoke + input assertions via a `window.__vylux` debug hook

## Safety posture

**Safety criteria: N/A** — this phase introduces no network endpoints, no user text input fields, and no query interpolation. The only new global surface is `window.__vylux.{state, debug}`, which is written exclusively by application code (never by user input). It is gated to dev/test builds via `import.meta.env.DEV`; the production build produced by `npm run build` must not expose it (verified by a Playwright run against `npm run preview`).

## State ownership (processing model)

The input -> state -> scene triad is the only cross-module bridge in this phase. Ownership contract:

- `src/placement.ts` is the **single source of truth** for `{ mode, selectedUnitType, hoveredTile, placedUnits }`. All transitions are pure functions that take current state + event and return next state.
- `src/input.ts` is a thin dispatcher: it listens for `keydown`, `pointermove`, `pointerdown`, and `resize`, calls the pure transitions on `placement.ts`, and never mutates scene objects directly.
- `src/scene.ts` reads state from `placement.ts` via a pull model during the per-frame update — no direct writes from input handlers. Scene objects (hover highlight material, ghost mesh visibility, placed meshes) are reconciled to the current state each frame.
- `window.__vylux.state` is a read-only mirror of `placement.ts`'s state, exposed for test assertions. Tests must never mutate it.

This contract is enforced by a Vitest source-scan test: `src/scene.ts` contains zero imports from `src/input.ts`, and `src/input.ts` contains zero imports from `src/scene.ts`.

## Stories

### US-01 — Isometric scene foundation

As a player, I want the page to load into a dark isometric 3D scene, so that I have a stable visual canvas before any game content is added.

**Acceptance criteria:**
- Page loads `index.html` and renders a Three.js scene in a full-viewport `<canvas>` with no console errors.
- Scene background is charcoal (`#0a0a0a`).
- Camera is an `OrthographicCamera` oriented at the classic isometric angle (rotated 45° around Y, pitched ~30° below horizontal), looking at the grid origin.
- Scene contains one ambient light at low intensity and one directional light positioned to cast subtle shading on emissive meshes.
- Canvas resizes when the browser window resizes; aspect is preserved without distorting the isometric projection.

**User guidance:**
- Discovery: open `index.html` after running `npm run dev`, or open `npm run build` output in a browser.
- Manual section: new page — `docs/manual/foundation.md`.
- Key steps: (1) `npm install`, (2) `npm run dev`, (3) open the printed localhost URL — the dark scene appears immediately.

**Design rationale:** Orthographic camera (not perspective) because isometric is the core aesthetic commitment — perspective would break the Tron grid read.

### US-02 — Neon tile grid

As a player, I want to see a 20x20 grid of individually-addressable tiles with faint neon dividers, so that the playfield reads as the Tron-inspired grid and every tile can be interacted with later.

**Acceptance criteria:**
- Grid is exactly 20x20 tiles (400 tile meshes) centered on the scene origin.
- Each tile is an independent mesh (not a single merged geometry) so it can be recolored without affecting neighbors.
- Each tile's base material is near-black charcoal, visually blending with the scene background.
- Faint emissive white lines render between every pair of adjacent tiles and around the grid perimeter — thin, low intensity, visible against the charcoal background.
- Every tile is a valid raycast target (hit test returns the tile mesh the pointer is over).
- Tile world coordinates are derived from a documented grid-coordinate function: `(tileX, tileY) in [0..19] x [0..19]` maps to a stable world `(x, z)` with `y = 0`.

**User guidance:**
- Discovery: the grid is visible immediately on page load.
- Manual section: `docs/manual/foundation.md` — "The grid".
- Key steps: load the page — a 20x20 neon-outlined grid sits at the center of the dark scene. No interaction required to see it.

**Design rationale:** Independent tile meshes over a single textured plane because per-tile recoloring (hover preview, occupied indicator) is required every phase after this — a merged mesh would force a rewrite. 20x20 is the brief's stated MVP size; small enough to read as a complete field at fixed camera distance, large enough to feel like a playfield. White emissive dividers (not cyan) so faction colors — cyan blue and red-orange — remain the read when a tile is hovered or occupied; dividers sit below faction signal in the visual hierarchy. Line meshes (not a shader or texture) so the same recoloring flexibility extends to the grid-line layer if future phases want faction-tinted territory markers.

### US-03 — Placement mode state machine

As a player, I want keyboard keys `1`, `2`, and `Escape` to drive a clear placement-mode state machine, so that I can choose which faction's unit I'm about to place and cancel cleanly.

**Acceptance criteria:**
- Pressing `1` when state is `idle` transitions to placement mode with `selectedUnitType = 'blue'`.
- Pressing `2` when state is `idle` transitions to placement mode with `selectedUnitType = 'red'`.
- Pressing `1` when state is placement with `selectedUnitType = 'red'` switches `selectedUnitType` to `'blue'` (stays in placement mode).
- Pressing `2` when state is placement with `selectedUnitType = 'blue'` switches `selectedUnitType` to `'red'` (stays in placement mode).
- Pressing `Escape` from placement mode returns to `idle`, clears `selectedUnitType`, and clears any hover state.
- Pressing any other key is ignored in both states (no console errors, no state change).
- While in placement mode, the browser cursor is hidden (`cursor: none` applied to the canvas); while in `idle`, the cursor is the default pointer.
- Placement-mode state is exposed on `window.__vylux.state` with shape `{ mode: 'idle' | 'placement', selectedUnitType: null | 'blue' | 'red' }` for testing.

**Interaction model:** New to the project — keyboard-driven mode toggle with no on-screen indicator beyond the cursor change and hover preview. Users discover the controls through the manual page for this phase; no in-app HUD yet.

**User guidance:**
- Discovery: documented in the manual page; no in-app prompt in this phase.
- Manual section: `docs/manual/foundation.md` — "Controls".
- Key steps: (1) press `1` to pick blue, (2) press `2` to pick red, (3) press `Esc` to cancel.

**Design rationale:** A tiny explicit state machine (`idle` / `placement`) instead of ad-hoc flags because every subsequent phase will add modes (select, move, attack). The shape chosen here is the foundation future modes extend.

### US-04 — Hover preview with ghost unit

As a player in placement mode, I want the tile under my cursor to highlight in my faction's color and show a translucent ghost of the unit I'm about to place, so that I know exactly where the click will land before I commit.

**Acceptance criteria:**
- While in placement mode, moving the mouse over the grid raycasts and identifies exactly one hovered tile per frame.
- The hovered tile's material switches to a dim faction color (dim cyan for blue, dim red-orange for red); moving to a new tile reverts the previous tile to its base charcoal material within the same frame.
- A semi-transparent "ghost" unit mesh (faction-colored emissive, ~0.4 opacity) renders on the hovered tile at the same position the placed unit would occupy.
- Switching faction mid-hover (`1` -> `2` or `2` -> `1`) updates both the hover tile color and the ghost unit color without requiring a mouse move.
- When the mouse leaves the grid (raycast returns no tile), both the dim highlight and the ghost mesh are hidden; the previously-hovered tile reverts to charcoal.
- When state returns to `idle` (either by placing a unit or pressing `Escape`), the ghost mesh is hidden and any hover highlight clears.
- Hovering an already-occupied tile still shows the dim highlight in the faction color but suppresses the ghost mesh (signals the tile is not a valid target without adding a new red-flash primitive).
- Current hover target is exposed on `window.__vylux.state.hoveredTile` as `{ tileX: number, tileY: number } | null`.

**Interaction model:** New to the project — continuous raycast-driven hover. Matches conventional RTS / builder placement UX. The suppressed ghost on occupied tiles is the sole visual signal for occupancy; no sound, no flash.

**User guidance:**
- Discovery: visible as soon as placement mode is entered.
- Manual section: `docs/manual/foundation.md` — "Placing units".
- Key steps: (1) enter placement mode, (2) move mouse over the grid — the hovered tile dims to faction color and a ghost unit appears, (3) move to another tile — the previous tile clears.

**Design rationale:** Ghost-suppression (rather than a red flash or blocked-cursor icon) is the cheapest clear signal for "invalid target" — reuses the same visual vocabulary as a valid target minus the ghost, so users don't need a new symbol. Matches the brief's stated preference for silent reject.

### US-05 — Click to place, respect occupancy, exit cleanly

As a player in placement mode, I want left-clicking on a valid tile to commit a solid unit there and return me to idle, so that placement is a single decisive action and I can repeat the cycle.

**Acceptance criteria:**
- Left-click on a hovered unoccupied tile while in placement mode: a solid (non-transparent) unit mesh of the selected faction appears on that tile at `y = 0` + unit-height/2.
- After placement, the placed-on tile reverts from hover color to charcoal, the ghost mesh hides, the canvas cursor returns to default pointer, and state returns to `idle` with `selectedUnitType = null`.
- Left-click on a hovered **occupied** tile in placement mode: no unit is placed, state stays in placement mode, cursor stays hidden, the previously-placed unit remains visible and unchanged.
- Left-click outside the grid (raycast returns no tile) while in placement mode: state returns to `idle`, cursor returns to default pointer, any hover or ghost state clears — **no unit is placed**.
- `placedUnits` array on `window.__vylux.state` holds one entry per placed unit with shape `{ tileX, tileY, type: 'blue' | 'red' }` and length equals the cumulative count of successful placements.
- Attempting to place two units on the same `(tileX, tileY)` never succeeds — the second click is silently rejected and `placedUnits.length` does not increase.
- Right-click, middle-click, and any non-left mouse button are ignored in both states.

**Interaction model:** New to the project — single left-click commits, placement mode auto-exits. Matches the brief.

**User guidance:**
- Discovery: follows directly from US-04 hover.
- Manual section: `docs/manual/foundation.md` — "Placing units".
- Key steps: (1) hover a tile, (2) left-click — the ghost becomes a solid unit and placement mode exits, (3) press `1` or `2` again to place another.

**Design rationale:** Auto-exit placement mode after a single click (vs. staying-in-mode until `Esc`) mirrors the brief's explicit DoD and keeps the first phase's state machine minimal. Future phases can introduce a "sticky placement" toggle if the UX calls for it.

## Done-when (observable)

### Scene and grid
- [ ] `index.html` and `src/main.ts` exist at project root; `package.json` declares `three`, `@types/three`, `vite`, `typescript`, `vitest`, `@playwright/test` as dependencies [US-01]
- [ ] `npm install && npm run build` completes without errors in a clean clone [US-01]
- [ ] `npm run dev` smoke test: a short shell/Playwright script spawns the dev server, polls `http://localhost:<printed-port>/` for HTTP 200 within 10s, then kills the process; port is >= 1024 (non-privileged) [US-01]
- [ ] `npm run dev` serves the app; page loads with no console errors and no uncaught promise rejections (verified by Playwright smoke test) [US-01]
- [ ] `tsconfig.json` declares `"strict": true`, `"noUnusedParameters": true`, `"noUnusedLocals": true`; `npx tsc --noEmit` passes [phase]
- [ ] Verify command documented in `AGENTS.md` is `npx tsc --noEmit && npm run test && npm run test:e2e` and is the same command the test-gate runs locally [phase]
- [ ] WebGL context-loss handling: simulated `webglcontextlost` event on the canvas logs via `console.error` with context (never silent), does not throw uncaught, and sets `window.__vylux.debug.contextLost === true` (Playwright) [US-01]
- [ ] Scene background color is exactly `#0a0a0a` (asserted via `window.__vylux.debug.backgroundColor`) [US-01]
- [ ] Scene contains an `OrthographicCamera` (not `PerspectiveCamera`) — asserted by `window.__vylux.debug.cameraType === 'OrthographicCamera'` [US-01]
- [ ] Camera rotation is 45° around world Y and pitched ~30° below horizontal (asserted within 0.5° tolerance via `window.__vylux.debug.cameraRotation`) [US-01]
- [ ] Scene contains at least one `AmbientLight` and one `DirectionalLight` (asserted via `window.__vylux.debug.lightCounts`) [US-01]
- [ ] Canvas resizes on `window.resize`: Playwright test that changes viewport size and asserts canvas width/height matches [US-01]
- [ ] Grid contains exactly 400 independent tile meshes (asserted via `window.__vylux.debug.tileCount === 400`) [US-02]
- [ ] Tile coordinate helper `tileToWorld(tileX, tileY)` exists in `src/grid.ts` and is unit-tested (Vitest): `(0,0)`, `(19,19)`, and a mid-grid coordinate each return deterministic world positions; all 400 positions are unique [US-02]
- [ ] Each tile's default material color is `#0a0a0a` (asserted by sampling `window.__vylux.debug.tileColors[i]` for 10 randomly-chosen indices) [US-02]
- [ ] Grid line meshes (or line segments) exist and use an emissive white material with low intensity (asserted via `window.__vylux.debug.gridLineMaterial.emissiveIntensity > 0 && emissive === 0xffffff`) [US-02]
- [ ] Raycasting from viewport center hits a tile mesh and returns a valid `(tileX, tileY)` (Playwright test) [US-02]

### Placement-mode state machine
- [ ] Unit test (Vitest): from `{ mode: 'idle', selectedUnitType: null }`, key `1` -> `{ mode: 'placement', selectedUnitType: 'blue' }` [US-03]
- [ ] Unit test (Vitest): from `{ mode: 'idle', selectedUnitType: null }`, key `2` -> `{ mode: 'placement', selectedUnitType: 'red' }` [US-03]
- [ ] Unit test (Vitest): from `{ mode: 'placement', selectedUnitType: 'red' }`, key `1` -> `{ mode: 'placement', selectedUnitType: 'blue' }` [US-03]
- [ ] Unit test (Vitest): from `{ mode: 'placement', selectedUnitType: 'blue' }`, key `2` -> `{ mode: 'placement', selectedUnitType: 'red' }` [US-03]
- [ ] Unit test (Vitest): from `{ mode: 'placement', ... }`, key `Escape` -> `{ mode: 'idle', selectedUnitType: null }` [US-03]
- [ ] Unit test (Vitest): unhandled keys (`a`, `3`, `Enter`, `Space`, `Shift`) leave state unchanged and throw no errors [US-03]
- [ ] Playwright: pressing `1` sets canvas style `cursor: none`; pressing `Escape` restores `cursor: default` (or `pointer`) [US-03]
- [ ] `window.__vylux.state.mode` and `window.__vylux.state.selectedUnitType` reflect the documented shape at every transition (Playwright assertion) [US-03]

### Hover preview
- [ ] Unit test (Vitest): hover logic given a hovered tile returns correct dim color for blue (`#0d4d57`) and red (`#5a2311`) — matches documented hexes in the Design direction section [US-04]
- [ ] Playwright: entering blue placement mode and moving mouse over the grid sets `window.__vylux.state.hoveredTile` to a non-null `{ tileX, tileY }` [US-04]
- [ ] Playwright: moving mouse from tile A to tile B causes tile A's material color to revert to `#0a0a0a` in the same frame tile B becomes the hovered tile [US-04]
- [ ] Playwright: while hovering a tile in blue placement mode, the scene contains exactly one ghost mesh with opacity ~0.4 and faction-cyan emissive color (asserted via `window.__vylux.debug.ghost`) [US-04]
- [ ] Playwright: switching from blue to red (`1` -> `2`) while hovering updates both hover tile color and ghost mesh color without a mouse move [US-04]
- [ ] Playwright: moving mouse off the grid causes `window.__vylux.state.hoveredTile === null` and hides the ghost mesh (`window.__vylux.debug.ghost.visible === false`) [US-04]
- [ ] Playwright: returning to `idle` (via `Escape`) hides ghost mesh and clears any hover highlight [US-04]
- [ ] Playwright: hovering an occupied tile shows the dim faction highlight AND hides the ghost mesh (occupied signal) [US-04]
- [ ] Playwright: rapid mouse sweep across the grid (20 `page.mouse.move` calls in < 200ms) never throws, ends with `hoveredTile` reflecting the final cursor position, and `window.__vylux.debug.ghostCount === 1` at the final frame (no leaked ghost meshes) [US-04]
- [ ] Unit test (Vitest): `handlePointerMove` called 5 times synchronously with different coords leaves `state.hoveredTile` equal to the last coord only, and a `reconcileScene(state)` call after produces exactly one visible ghost mesh [US-04]

### Click placement and occupancy
- [ ] Unit test (Vitest): `tryPlace(state, tileX, tileY)` on an unoccupied tile returns `{ ok: true, state: nextState }` with `placedUnits.length` incremented by 1 and `mode: 'idle'` [US-05]
- [ ] Unit test (Vitest): `tryPlace(state, tileX, tileY)` on an already-occupied tile returns `{ ok: false, reason: 'occupied' }` and state is unchanged [US-05]
- [ ] Unit test (Vitest): `tryPlace` with out-of-bounds coords (`(-1, 0)`, `(0, 20)`, `(20, 20)`, `(NaN, 0)`) returns `{ ok: false, reason: 'out-of-bounds' }` and state is unchanged [US-05]
- [ ] Playwright: after pressing `1`, hovering tile `(5, 5)`, and left-clicking: `placedUnits.length === 1`, entry has `{ tileX: 5, tileY: 5, type: 'blue' }`, mode is `idle`, ghost is hidden, cursor returns to default [US-05]
- [ ] Playwright: same flow for red (press `2` then click `(7, 3)`): `placedUnits` has a `{ type: 'red' }` entry [US-05]
- [ ] Playwright (per-faction): placed blue unit mesh renders with cyan emissive material; placed red unit mesh renders with red-orange emissive material (asserted via `window.__vylux.debug.placedMeshes[i].material.emissive`) [US-05]
- [ ] Playwright: clicking the same occupied tile again in placement mode does not increase `placedUnits.length` and does not exit placement mode [US-05]
- [ ] Playwright: left-click outside the grid while in placement mode exits to `idle` without adding to `placedUnits` [US-05]
- [ ] Playwright: right-click and middle-click in placement mode do not place a unit and do not change state [US-05]

### Visual "reads as" criteria (paired: measurable proxy + operator sign-off)

Each visual "reads as" claim is backed by a mechanical proxy asserting the underlying material/geometry values plus an operator sign-off that the composed result reads correctly on-screen. Operator sign-off lives in `docs/manual-verification/foundation.md`.

- [ ] Manual verification doc `docs/manual-verification/foundation.md` exists with one checkbox per "reads as" item below; every item is signed off before phase close [phase]
- [ ] Grid divider material: `material.emissive.getHexString() === 'ffffff'` and `material.emissiveIntensity` is in `[0.1, 0.4]` (low-intensity band — asserted via `window.__vylux.debug.gridLineMaterial`) [US-02]
- [ ] Operator sign-off: grid "reads as" a Tron-style neon grid — white dividers visible against charcoal, tiles nearly invisible between the lines [US-02]
- [ ] Ghost mesh material: `material.transparent === true` and `material.opacity` is in `[0.35, 0.45]` (asserted via `window.__vylux.debug.ghost.material`) [US-04]
- [ ] Ghost mesh blue: `material.emissive.getHexString() === '00e5ff'` (documented cyan hex) [US-04]
- [ ] Ghost mesh red: `material.emissive.getHexString() === 'ff5a1f'` (documented red-orange hex) [US-04]
- [ ] Operator sign-off: ghost unit (blue) reads as a placeholder — translucent, cyan, positioned on the hovered tile [US-04]
- [ ] Operator sign-off: ghost unit (red) reads as a placeholder — translucent, red-orange, positioned on the hovered tile [US-04]
- [ ] Placed mesh blue: `material.transparent === false`, `material.opacity === 1.0`, `material.emissive.getHexString() === '00e5ff'` [US-05]
- [ ] Placed mesh red: `material.transparent === false`, `material.opacity === 1.0`, `material.emissive.getHexString() === 'ff5a1f'` [US-05]
- [ ] Operator sign-off: placed unit (blue) reads as committed — solid, emissive, visibly different from the ghost [US-05]
- [ ] Operator sign-off: placed unit (red) reads as committed — solid, emissive, visibly different from the ghost [US-05]
- [ ] Hover tile blue material: `material.color.getHexString() === '0d4d57'` (documented dim cyan) [US-04]
- [ ] Hover tile red material: `material.color.getHexString() === '5a2311'` (documented dim red-orange) [US-04]
- [ ] Operator sign-off: hover tile highlights read as selectable targets in each faction — dim enough not to compete with the ghost, clearly the faction hue [US-04]

### Documentation and reconciliation
- [ ] `docs/manual/foundation.md` exists and covers: how to run the app, the grid layout, the keyboard controls (`1`, `2`, `Esc`), hover preview, click to place, occupancy rule, exit via outside-grid click [US-01, US-02, US-03, US-04, US-05]
- [ ] `README.md` top-level section includes the quick-start (`npm install`, `npm run dev`) and links to `docs/manual/foundation.md` [US-01]
- [ ] `AGENTS.md` reflects the introduced stack (TypeScript + Three.js + Vite), the `src/` module layout, the state machine shape, the verify command, and the state-ownership contract introduced in this phase (handled at Phase Reconciliation Gate) [phase]
- [ ] Production build guard: `npm run build` followed by `npm run preview` serves an index where `window.__vylux === undefined` (Playwright against the preview server); dev build at `npm run dev` exposes it [phase]

### Auto-added safety criteria
- [ ] Error-path coverage: every event handler (`keydown`, `mousemove`, `click`, `resize`) has at least one unit or Playwright test covering its no-op branch (e.g., `keydown` for an unbound key, `click` with no hovered tile, `mousemove` off the grid) [phase]
- [ ] No bare catches / silent swallowing: any `try`/`catch` in the codebase either re-throws or logs via `console.error` with context — enforced by a Vitest source-scan test that greps `src/**/*.ts` for `catch (` patterns and asserts each matching block contains either `throw` or `console.error` [phase]
- [ ] Event listener cleanup: `keydown`, `mousemove`, `click`, and `resize` listeners are attached via a single `attachInputHandlers` function that also returns a `detach()` callback; Vitest verifies `detach()` removes the listeners [phase]

## Golden principles (phase-relevant)

- **no-silent-pass** — code paths that reject input (occupied-tile click, unbound key, off-grid click) must be represented in state and tests, not hidden behind a silent `return`. "Silent reject" at the user level still means "tested branch" at the code level.
- **no-bare-except** — TypeScript equivalent: no `catch (e) {}` or `catch { /* ignore */ }`. Errors in render loop / raycast / input handlers either re-throw or are logged with context.
- **error-path-coverage** — every event handler has at least one test covering its no-op / error branch, not just the happy path.
- **agents-consistency** — `AGENTS.md` is updated at phase close to reflect the tech stack, module layout, and state machine introduced here.

## AGENTS.md sections affected (for Phase Reconciliation Gate)

Current `AGENTS.md` has only `Purpose` and `Quality checks`. After this phase ships, reconciliation must add:

- **Tech stack** — TypeScript, Three.js, Vite, Vitest, Playwright; run commands and verify command.
- **Module layout** — `src/main.ts` (composition root), `src/scene.ts`, `src/grid.ts`, `src/input.ts`, `src/placement.ts` (state machine), plus tests under `src/**/*.test.ts` and `tests/e2e/`.
- **State machine** — the `idle` / `placement` shape introduced in US-03 is the foundation future modes extend; document the contract.
- **State ownership** — the `placement.ts` owns state / `input.ts` dispatches / `scene.ts` pulls contract from the State ownership section above.
- **Debug hook** — `window.__vylux.{state, debug}` is a test-only surface, dev-gated, and must remain stable across phases that add tests against it.
- **Project type** — declare a `## Project type` heading (`three-js-game` or similar) so future phase-goal-reviews can pick up domain-scoped learnings.

Reconciliation rule: updates to `AGENTS.md` and any future `ARCHITECTURE.md` reflect **shipped state only**. No "planned for" annotations, no "structural intent" sections for unbuilt phases. Forward-looking content belongs in per-phase spec files, not architecture docs.

## User documentation impact

- **New file:** `docs/manual/foundation.md` — quick-start, grid, controls, placing units, cancelling.
- **Updated file:** `README.md` — add quick-start section at top + link to the manual page.
- No existing manual pages to update (first manual page in the project).

## Readiness notes

- Phase size: 5 stories (at the split limit; each is small and tightly scoped to a single testable behavior — no cross-story entanglement that would force a split).
- Interaction model: mode-switch + raycast hover + left-click is new to the project (first phase) — each story with interaction includes an explicit interaction-model note.
- Consumer adaptation: N/A — no shared library extraction in this phase.
- Processing model: the input -> state -> scene triad is the in-phase bridge — contract locked in the State ownership section above.
- Variant baseline: two faction variants (`blue`, `red`); every user-visible behavior has per-faction done-when criteria (hover color, ghost color, placed color, placement success).
- Per-phase doc pattern: this draft is the first phase; from phase 2 onward, specs live in `docs/product/phases/<phase>.md` with a summary row in `docs/product/PRD.md` (index table only — no inline stories).
- Commit convention: progress-tick commits on the build branch are prefixed `wip:` and squashed out at merge; only `feat:` / `test:` / `docs:` / `chore:` commits appear in `main`'s history.
- Stale-origin guard (for subsequent phases): every future phase `start` must run `git fetch origin` before branching, so the foundation merge is visible locally before phase 2 begins.
- Deployment: out of scope this phase — no GitHub Pages, no hosting workflow. All commits land on `build/foundation` and merge via PR only; no direct pushes to `main`.

## Scoped out of this phase (explicit)

Listed here so future phases can pick them up without re-deriving them:

- **On-screen mode indicator.** No HUD label showing current faction when the pointer is off-grid — the only mode signal is `cursor: none` + the faction-colored hover highlight when the pointer is on a tile. A pointer parked off-grid in placement mode is ambiguous to the player. Follow-up candidate for next phase.
- **Remove/replace/undo placement.** Placement is additive only this phase; there is no way to delete a placed unit or switch its faction. Follow-up candidate.
- **CI workflow.** No `.github/workflows/ci.yml` in this phase. Local verify command (`npx tsc --noEmit && npm run test && npm run test:e2e`) is the only gate. A dedicated `ci-bootstrap` phase should follow foundation before phase 3.
- **Cache-control on the built shell.** `npm run build` output uses Vite defaults; no explicit `Cache-Control` headers on `index.html`. Revisit when a dogfood deploy target is added.
- **WebGL fallback UX.** Context loss is detected and logged (done-when above) but no user-visible recovery UI — a blank canvas is the current UX for that edge case.
