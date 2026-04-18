Here's a concise spec you can paste directly into your spec-author:

---

**Project: Tron-Inspired Isometric Grid — Unit Placement Prototype**

**Tech stack**
- Three.js (latest stable, via CDN or npm)
- Vanilla JS/TS, single HTML entry point
- No game framework, no build tooling required beyond what Three.js needs

**Scene setup**
- Charcoal black background (`#0a0a0a` or similar near-black)
- Isometric camera: `OrthographicCamera` positioned at classic isometric angle (rotate 45° around Y, ~30° down from horizontal)
- No orbit controls needed for MVP; camera is fixed
- Ambient light low, plus one directional light for subtle unit shading

**Grid**
- Flat plane composed of N×N tiles (start with 20×20)
- Each tile is an individual mesh so it can be recolored independently
- Faint white neon grid lines between tiles (emissive white material at low intensity, or a line overlay)
- Tile base color: charcoal black, near-invisible fill
- Tiles are the click/hover targets (raycasting)

**Unit types**
- Two unit types: `blue` (cyan neon) and `red` (red-orange neon)
- Each unit is a simple geometric mesh for now — suggest a low box or small extruded shape with emissive material in faction color
- Units occupy exactly one tile and sit on top of it

**Input — keyboard**
- Key `1` → enter placement mode for blue unit
- Key `2` → enter placement mode for red unit
- Key `Escape` → exit placement mode, return to default cursor
- Pressing `1` or `2` while already in placement mode switches the selected unit type

**Input — mouse / cursor behavior**
- Default state: normal pointer cursor, no hover preview on grid
- Placement mode active:
  - Cursor visually changes to indicate a unit is "held" (simplest approach: hide system cursor via CSS `cursor: none` and render a small ghost preview mesh at the hovered tile; alternative: swap to a custom CSS cursor image)
  - As mouse moves over the grid, raycast to find the hovered tile
  - The hovered tile changes color to a preview shade of the selected faction (dim cyan or dim red-orange) to indicate where the unit will be placed
  - Only one tile is highlighted at a time; previous hover clears when moving to a new tile
  - A ghost/preview version of the unit (semi-transparent) renders on the hovered tile
- On left click while in placement mode:
  - A solid unit of the selected type is placed on that tile
  - Tile reverts to its base color (the unit itself now occupies it visually)
  - Placement mode exits automatically
  - Cursor returns to normal pointer
- Clicking outside the grid in placement mode: do nothing (or exit placement mode — pick one; suggest exit)

**State to track**
- `selectedUnitType`: `null | 'blue' | 'red'`
- `hoveredTile`: reference to currently hovered tile mesh, or `null`
- `placedUnits`: array of `{ tileX, tileY, type, mesh }` — prevents double-placement on same tile
- Attempting to place on an already-occupied tile: reject silently (or flash tile red briefly — MVP can just reject)

**File structure (suggested minimal)**
- `index.html` — canvas + script tag
- `main.js` — scene, camera, renderer, grid, input handlers, render loop
- Keep it all in one file for v1; refactor later if needed

**Out of scope for this spec (do not build)**
- Resource collection, unit movement, combat, AI, multiplayer, sound, UI overlays, minimap
- Multiple tile sizes, multi-tile buildings, building types beyond the two placeholder units
- Saving/loading state
- Mobile/touch input

**Definition of done**
- I can load the page and see a dark isometric grid with faint white lines
- Pressing `1` enters blue placement mode; mouse over grid shows tile preview + ghost unit
- Clicking places a blue unit and returns to default state
- Pressing `2` does the same for red
- `Escape` cancels placement mode cleanly
- Cannot place two units on the same tile

---

That should give your spec-author enough to generate a tight, scoped implementation without scope creep. If your spec-author prefers a different structure (user stories, acceptance criteria as Gherkin, etc.), let me know and I can reshape it.