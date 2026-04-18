## Phase goal

Stand up the visual and interaction foundation for Vylux: a Three.js isometric scene with a 20x20 neon grid, keyboard-driven unit placement mode for two factions (blue / red), hover preview with ghost unit, left-click placement, and per-tile occupancy enforcement. No gameplay systems are in scope — this phase proves the rendering pipeline, the placement-mode state machine, and the faction visual identity. Output is a playable prototype a user can load, toggle into blue/red placement, preview hover, click to commit a unit, and repeat.

Full spec: `docs/product/phases/foundation.md` (design direction, tech stack, state ownership contract, interaction models, and per-story rationale).

### Stories in scope
- US-01 — Isometric scene foundation
- US-02 — Neon tile grid
- US-03 — Placement mode state machine
- US-04 — Hover preview with ghost unit
- US-05 — Click to place, respect occupancy, exit cleanly

### Done-when (observable)

#### Scene and grid
- [x] `index.html` and `src/main.ts` exist at project root; `package.json` declares `three`, `@types/three`, `vite`, `typescript`, `vitest`, `@playwright/test` as dependencies [US-01]
- [x] `npm install && npm run build` completes without errors in a clean clone [US-01]
- [x] `npm run dev` smoke test: a short shell/Playwright script spawns the dev server, polls `http://localhost:<printed-port>/` for HTTP 200 within 10s, then kills the process; port is >= 1024 (non-privileged) [US-01]
- [x] `npm run dev` serves the app; page loads with no console errors and no uncaught promise rejections (verified by Playwright smoke test) [US-01]
- [ ] `tsconfig.json` declares `"strict": true`, `"noUnusedParameters": true`, `"noUnusedLocals": true`; `npx tsc --noEmit` passes [phase]
- [ ] Verify command documented in `AGENTS.md` is `npx tsc --noEmit && npm run test && npm run test:e2e` and is the same command the test-gate runs locally [phase]
- [x] WebGL context-loss handling: simulated `webglcontextlost` event on the canvas logs via `console.error` with context (never silent), does not throw uncaught, and sets `window.__vylux.debug.contextLost === true` (Playwright) [US-01]
- [x] Scene background color is exactly `#0a0a0a` (asserted via `window.__vylux.debug.backgroundColor`) [US-01]
- [x] Scene contains an `OrthographicCamera` (not `PerspectiveCamera`) — asserted by `window.__vylux.debug.cameraType === 'OrthographicCamera'` [US-01]
- [x] Camera rotation is 45° around world Y and pitched ~30° below horizontal (asserted within 0.5° tolerance via `window.__vylux.debug.cameraRotation`) [US-01]
- [x] Scene contains at least one `AmbientLight` and one `DirectionalLight` (asserted via `window.__vylux.debug.lightCounts`) [US-01]
- [x] Canvas resizes on `window.resize`: Playwright test that changes viewport size and asserts canvas width/height matches [US-01]
- [x] Grid contains exactly 400 independent tile meshes (asserted via `window.__vylux.debug.tileCount === 400`) [US-02]
- [x] Tile coordinate helper `tileToWorld(tileX, tileY)` exists in `src/grid.ts` and is unit-tested (Vitest): `(0,0)`, `(19,19)`, and a mid-grid coordinate each return deterministic world positions; all 400 positions are unique [US-02]
- [x] Each tile's default material color is `#0a0a0a` (asserted by sampling `window.__vylux.debug.tileColors[i]` for 10 randomly-chosen indices) [US-02]
- [x] Grid line meshes (or line segments) exist and use an emissive white material with low intensity (asserted via `window.__vylux.debug.gridLineMaterial.emissiveIntensity > 0 && emissive === 0xffffff`) [US-02]
- [x] Raycasting from viewport center hits a tile mesh and returns a valid `(tileX, tileY)` (Playwright test) [US-02]

#### Placement-mode state machine
- [x] Unit test (Vitest): from `{ mode: 'idle', selectedUnitType: null }`, key `1` -> `{ mode: 'placement', selectedUnitType: 'blue' }` [US-03]
- [x] Unit test (Vitest): from `{ mode: 'idle', selectedUnitType: null }`, key `2` -> `{ mode: 'placement', selectedUnitType: 'red' }` [US-03]
- [x] Unit test (Vitest): from `{ mode: 'placement', selectedUnitType: 'red' }`, key `1` -> `{ mode: 'placement', selectedUnitType: 'blue' }` [US-03]
- [x] Unit test (Vitest): from `{ mode: 'placement', selectedUnitType: 'blue' }`, key `2` -> `{ mode: 'placement', selectedUnitType: 'red' }` [US-03]
- [x] Unit test (Vitest): from `{ mode: 'placement', ... }`, key `Escape` -> `{ mode: 'idle', selectedUnitType: null }` [US-03]
- [x] Unit test (Vitest): unhandled keys (`a`, `3`, `Enter`, `Space`, `Shift`) leave state unchanged and throw no errors [US-03]
- [x] Playwright: pressing `1` sets canvas style `cursor: none`; pressing `Escape` restores `cursor: default` (or `pointer`) [US-03]
- [x] `window.__vylux.state.mode` and `window.__vylux.state.selectedUnitType` reflect the documented shape at every transition (Playwright assertion) [US-03]

#### Hover preview
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

#### Click placement and occupancy
- [ ] Unit test (Vitest): `tryPlace(state, tileX, tileY)` on an unoccupied tile returns `{ ok: true, state: nextState }` with `placedUnits.length` incremented by 1 and `mode: 'idle'` [US-05]
- [ ] Unit test (Vitest): `tryPlace(state, tileX, tileY)` on an already-occupied tile returns `{ ok: false, reason: 'occupied' }` and state is unchanged [US-05]
- [ ] Unit test (Vitest): `tryPlace` with out-of-bounds coords (`(-1, 0)`, `(0, 20)`, `(20, 20)`, `(NaN, 0)`) returns `{ ok: false, reason: 'out-of-bounds' }` and state is unchanged [US-05]
- [ ] Playwright: after pressing `1`, hovering tile `(5, 5)`, and left-clicking: `placedUnits.length === 1`, entry has `{ tileX: 5, tileY: 5, type: 'blue' }`, mode is `idle`, ghost is hidden, cursor returns to default [US-05]
- [ ] Playwright: same flow for red (press `2` then click `(7, 3)`): `placedUnits` has a `{ type: 'red' }` entry [US-05]
- [ ] Playwright (per-faction): placed blue unit mesh renders with cyan emissive material; placed red unit mesh renders with red-orange emissive material (asserted via `window.__vylux.debug.placedMeshes[i].material.emissive`) [US-05]
- [ ] Playwright: clicking the same occupied tile again in placement mode does not increase `placedUnits.length` and does not exit placement mode [US-05]
- [ ] Playwright: left-click outside the grid while in placement mode exits to `idle` without adding to `placedUnits` [US-05]
- [ ] Playwright: right-click and middle-click in placement mode do not place a unit and do not change state [US-05]

#### Visual "reads as" criteria (paired: measurable proxy + operator sign-off)
- [ ] Manual verification doc `docs/manual-verification/foundation.md` exists with one checkbox per "reads as" item below; every item is signed off before phase close [phase]
- [x] Grid divider material: `material.emissive.getHexString() === 'ffffff'` and `material.emissiveIntensity` is in `[0.1, 0.4]` (low-intensity band — asserted via `window.__vylux.debug.gridLineMaterial`) [US-02]
- [x] Operator sign-off: grid "reads as" a Tron-style neon grid — white dividers visible against charcoal, tiles nearly invisible between the lines [US-02]
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

#### Documentation and reconciliation
- [ ] `docs/manual/foundation.md` exists and covers: how to run the app, the grid layout, the keyboard controls (`1`, `2`, `Esc`), hover preview, click to place, occupancy rule, exit via outside-grid click [US-01, US-02, US-03, US-04, US-05]
- [x] `README.md` top-level section includes the quick-start (`npm install`, `npm run dev`) and links to `docs/manual/foundation.md` [US-01]
- [ ] `AGENTS.md` reflects the introduced stack (TypeScript + Three.js + Vite), the `src/` module layout, the state machine shape, the verify command, and the state-ownership contract introduced in this phase (handled at Phase Reconciliation Gate) [phase]
- [ ] Production build guard: `npm run build` followed by `npm run preview` serves an index where `window.__vylux === undefined` (Playwright against the preview server); dev build at `npm run dev` exposes it [phase]

#### Auto-added safety criteria
- [ ] Error-path coverage: every event handler (`keydown`, `mousemove`, `click`, `resize`) has at least one unit or Playwright test covering its no-op branch (e.g., `keydown` for an unbound key, `click` with no hovered tile, `mousemove` off the grid) [phase]
- [ ] No bare catches / silent swallowing: any `try`/`catch` in the codebase either re-throws or logs via `console.error` with context — enforced by a Vitest source-scan test that greps `src/**/*.ts` for `catch (` patterns and asserts each matching block contains either `throw` or `console.error` [phase]
- [ ] Event listener cleanup: `keydown`, `mousemove`, `click`, and `resize` listeners are attached via a single `attachInputHandlers` function that also returns a `detach()` callback; Vitest verifies `detach()` removes the listeners [phase]

### Golden principles (phase-relevant)

- **no-silent-pass** — code paths that reject input (occupied-tile click, unbound key, off-grid click) must be represented in state and tested, not hidden behind a silent `return`. "Silent reject" at the user level still means "tested branch" at the code level.
- **no-bare-except** — TypeScript equivalent: no `catch (e) {}` or `catch { /* ignore */ }`. Errors in render loop / raycast / input handlers either re-throw or are logged via `console.error` with context.
- **error-path-coverage** — every event handler has at least one test covering its no-op / error branch, not just the happy path.
- **agents-consistency** — `AGENTS.md` is updated at phase close to reflect the tech stack, module layout, and state machine introduced here.

### State ownership contract (load-bearing across stories)

- `src/placement.ts` owns `{ mode, selectedUnitType, hoveredTile, placedUnits }`. All transitions are pure functions (current state + event -> next state).
- `src/input.ts` is a thin dispatcher. It listens for `keydown`, `pointermove`, `pointerdown`, `resize`, calls pure transitions on `placement.ts`, and never mutates scene objects directly.
- `src/scene.ts` reads state from `placement.ts` via a pull model during the per-frame update — no direct writes from input handlers. Scene objects reconcile to current state each frame.
- `window.__vylux.state` is a read-only mirror of `placement.ts` state for test assertions (dev builds only — `import.meta.env.DEV` gate).
- Vitest source-scan test enforces: `src/scene.ts` has zero imports from `src/input.ts`; `src/input.ts` has zero imports from `src/scene.ts`.

### Design direction pointer

Tron-inspired neon on charcoal. Documented hexes (source of truth for material assertions): blue/cyan `#00e5ff`, red-orange `#ff5a1f`, dim blue `#0d4d57`, dim red-orange `#5a2311`, grid divider white `#ffffff` (low emissive intensity), scene background `#0a0a0a`. Reference images at `docs/concepts/*.png`. Full direction, rationale, and safety posture in `docs/product/phases/foundation.md`.
