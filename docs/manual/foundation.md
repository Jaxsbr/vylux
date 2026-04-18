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

> TODO (US-02): 20×20 grid, tile coordinates, tile→world mapping, neon divider lines.

## Controls

> TODO (US-03): keyboard controls — `1` enters blue placement, `2` enters red placement, `Esc` returns to idle. Cursor hides during placement.

## Hover preview

> TODO (US-04): hover a tile in placement mode to see a dim faction highlight and a translucent ghost unit. Occupied tiles suppress the ghost.

## Click to place

> TODO (US-05): left-click to commit a unit. Occupancy is enforced (no two units per tile). Clicking outside the grid exits to idle. Right-click and middle-click are ignored.
