# Vylux — Foundation manual

The foundation phase delivers the visual and interaction scaffolding: an isometric Three.js scene, a 20×20 neon grid, keyboard-driven placement mode for two factions (blue cyan vs red-orange), hover preview with a ghost unit, and left-click placement with per-tile occupancy.

No gameplay systems (resources, AI, progression) are in scope here — this phase exists to prove the rendering pipeline and the placement-mode state machine.

## Quick start

Requirements: Node.js 18+, a modern WebGL2-capable browser.

```bash
npm install
npm run dev
```

Open <http://localhost:5180/>. You should see a charcoal scene rendered by an orthographic camera pitched ~30° below the horizon, lit by a soft ambient + directional pair. The canvas resizes with the browser window. If the WebGL context is lost, the app logs via `console.error` and marks `window.__vylux.debug.contextLost = true` rather than crashing.

### Debug hook (dev builds only)

In the dev server (`npm run dev`), `window.__vylux` is exposed for Playwright tests and manual inspection:

```js
window.__vylux.debug.backgroundColor  // '#0a0a0a'
window.__vylux.debug.cameraType       // 'OrthographicCamera'
window.__vylux.debug.cameraRotation   // { yawDeg: 45, pitchDeg: -30 }
window.__vylux.debug.lightCounts      // { ambient: 1, directional: 1 }
window.__vylux.debug.contextLost      // false
```

Production builds (`npm run build` → `npm run preview` on <http://localhost:5181/>) strip the hook — `window.__vylux === undefined` — via an `import.meta.env.DEV` gate. This is enforced by a Playwright assertion on the preview server.

## Grid layout

A 20×20 grid of unit tiles sits flat on the XZ ground plane, centered on the world origin. Coordinates `(tileX, tileY)` range from `(0, 0)` at the near corner to `(19, 19)` at the far corner:

- Tile `(0, 0)` world position: `(-9.5, 0, -9.5)`
- Tile `(19, 19)` world position: `(9.5, 0, 9.5)`
- Tile `(10, 10)` world position: `(0.5, 0, 0.5)`

Each tile is its own mesh with its own `MeshStandardMaterial` (default color `#0a0a0a`) so per-tile state changes — hover highlights, placed units — do not leak across the grid. Tile meshes carry `userData = { tileX, tileY }` for raycast lookup.

Between the tiles, 21 horizontal + 21 vertical divider strips share a single emissive-white `MeshStandardMaterial` (`emissive = 0xffffff`, `emissiveIntensity = 0.25`) drawn slightly above the tile plane (`y = 0.02`) so they don't z-fight. The divider material is the single source of truth for "grid line" visuals — adjusting its intensity retunes the whole grid.

The dev-only debug hook exposes grid state for Playwright and manual inspection:

```js
window.__vylux.debug.tileCount            // 400
window.__vylux.debug.tileColors[i]        // '#0a0a0a' for every tile at rest
window.__vylux.debug.gridLineMaterial     // { emissive: 'ffffff', emissiveIntensity: 0.25 }
window.__vylux.raycastCenter()            // { tileX, tileY } from viewport center, or null
```

See `src/grid.ts` for `GRID_CONSTANTS` and the `tileToWorld(tileX, tileY)` helper.

## Controls

Placement is driven by a small keyboard-first state machine in `src/placement.ts`:

| Key     | From         | To                                      | Side effect                  |
| ------- | ------------ | --------------------------------------- | ---------------------------- |
| `1`     | any          | `mode: 'placement', selectedUnitType: 'blue'` | cursor -> `none`             |
| `2`     | any          | `mode: 'placement', selectedUnitType: 'red'`  | cursor -> `none`             |
| `Esc`   | any          | `mode: 'idle', selectedUnitType: null`  | cursor -> `default`          |
| other   | any          | unchanged (same state reference)        | none                         |

While in placement mode the canvas cursor hides (`cursor: 'none'`) so the translucent ghost unit is the only thing tracking the pointer. `Esc` always returns to idle regardless of faction. Switching factions mid-placement (`1` -> `2` or `2` -> `1`) stays in placement mode and flips both the hover tile tint and the ghost color in the same frame (no mouse move required).

State-ownership contract:

- `src/placement.ts` owns `{ mode, selectedUnitType, hoveredTile, placedUnits }` — transitions are pure functions.
- `src/input.ts` is a thin dispatcher: it listens for `keydown`, `pointermove`, and `pointerdown`, calls pure transitions on `placement.ts`, and mutates nothing in the scene directly. `attachInputHandlers` returns a `detach()` callback that unbinds all three listeners.
- `src/scene.ts` reads the current state once per frame via `bundle.reconcile(state)` and updates meshes/materials to match — no back-channel writes from input handlers.

Debug hook (dev only):

```js
window.__vylux.state.mode              // 'idle' | 'placement'
window.__vylux.state.selectedUnitType  // 'blue' | 'red' | null
```

## Hover preview

Once in placement mode, moving the pointer over the grid drives `state.hoveredTile`. The per-frame `reconcile` updates two visual channels:

1. The hovered tile's material color is tinted to the dim faction hue — `#0d4d57` for blue, `#5a2311` for red. When the hover moves on, the previous tile reverts to `#0a0a0a` in the same frame the new tile gains its tint.
2. A single persistent translucent "ghost" mesh (`BoxGeometry 0.8^3`, `transparent: true`, `opacity: 0.4`, `emissiveIntensity: 1`) repositions to `tileToWorld(hoveredTile.x, hoveredTile.y)` with `y = 0.5` and flips its emissive color — `#00e5ff` (cyan) for blue, `#ff5a1f` (red-orange) for red.

Off-grid pointer moves clear `hoveredTile` to `null` and hide the ghost. `Esc` clears both the hover tint and the ghost even if the pointer is still over a tile. Hovering an occupied tile still paints the dim faction tint but suppresses the ghost (the tile reads as "cannot place here"); moving off and back re-activates the ghost as soon as the pointer leaves the occupied tile.

Rapid pointer sweeps do not leak meshes: exactly one ghost mesh exists at all times (verified by the `window.__vylux.debug.ghostCount === 1` invariant in tests).

Debug hook (dev only):

```js
window.__vylux.debug.ghost
// { visible, position: { x, y, z }, material: { emissive, opacity, transparent } }
window.__vylux.debug.ghostCount            // always 1
window.__vylux.debug.tileColors[i]         // live per-tile hex color
```

## Click to place

Left-clicking a tile in placement mode commits a unit. The `handleClick` transition (in `src/placement.ts`) returns either a fresh state (committed + exited to idle) or the same state reference (rejected), so the build-loop assertion pattern is `next === current ? no-op : setState(next)`.

Rules:

- **Left-click on empty tile in placement mode**: unit appended to `placedUnits` with `{ tileX, tileY, type }`, mode returns to `idle`, `selectedUnitType` resets to `null`, cursor returns to `default`.
- **Left-click on occupied tile**: no-op. `placedUnits` unchanged and mode stays in `placement`. The dim faction tint is still shown but the ghost is hidden while hovered.
- **Left-click outside the grid** (pointer over canvas but past the raycastable tile band): exits to `idle` without placing. This is the "commit-or-cancel" exit pattern — no accidental placements from fat-finger clicks.
- **Right-click / middle-click anywhere in placement mode**: no-op. Same state reference returned; never places a unit and never exits placement.
- **Any click in idle mode**: no-op.

Committed meshes render in the persistent `placed-units` THREE.Group (solid `BoxGeometry 0.8^3`, `transparent: false`, `opacity: 1`, `emissive === color === factionEmissive`, `emissiveIntensity: 1`) — visibly heavier than the translucent ghost. They are never removed in this phase (placement-only, no demolish).

Debug hook (dev only):

```js
window.__vylux.state.placedUnits        // Array<{ tileX, tileY, type }>
window.__vylux.debug.placedCount        // mirror of placedUnits.length
window.__vylux.debug.placedMeshes[i]
// { tileX, tileY, type, position: { x, y, z }, material: { emissive, opacity, transparent } }
```
