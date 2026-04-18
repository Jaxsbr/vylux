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

> TODO (US-03): keyboard controls — `1` enters blue placement, `2` enters red placement, `Esc` returns to idle. Cursor hides during placement.

## Hover preview

> TODO (US-04): hover a tile in placement mode to see a dim faction highlight and a translucent ghost unit. Occupied tiles suppress the ghost.

## Click to place

> TODO (US-05): left-click to commit a unit. Occupancy is enforced (no two units per tile). Clicking outside the grid exits to idle. Right-click and middle-click are ignored.
