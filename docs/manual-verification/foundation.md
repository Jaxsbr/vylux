# Foundation phase — operator sign-off

Visual "reads as" criteria require human eyeballs on the running app. Run `npm run dev`, open <http://localhost:5180/>, and exercise each flow below. Tick each box once the scene reads the way the entry describes. All six boxes must be ticked before the foundation phase can be declared complete (phase-goal.md L69).

## Grid (US-02)

- [x] Grid reads as a Tron-style neon grid — white dividers visible against charcoal, tiles nearly invisible between the lines (phase-goal.md L71).

**How to check:** Open the dev server. The scene should show a 20×20 grid centered on the world origin, with crisp emissive-white divider lines against the `#0a0a0a` background. Tiles should recede into the background between the dividers — the grid should read as "lines of light on dark," not "dark squares with lines."

## Hover preview (US-04)

- [x] Ghost unit (blue) reads as a placeholder — translucent, cyan, positioned on the hovered tile (phase-goal.md L75).
- [x] Ghost unit (red) reads as a placeholder — translucent, red-orange, positioned on the hovered tile (phase-goal.md L76).
- [x] Hover tile highlights read as selectable targets in each faction — dim enough not to compete with the ghost, clearly the faction hue (phase-goal.md L83).

**How to check:** Press `1` to enter blue placement mode, then move the mouse over the grid. The hovered tile should highlight in dim cyan, with a translucent cyan ghost unit on top. Press `2` to switch to red — both the tile highlight and the ghost should flip to dim red-orange + translucent red-orange ghost without requiring a mouse move. The ghost should read as "a preview, not a commit"; the tile highlight should read as "this is where you'd place it".

## Placed units (US-05)

- [x] Placed unit (blue) reads as committed — solid, emissive, visibly different from the ghost (phase-goal.md L79).
- [x] Placed unit (red) reads as committed — solid, emissive, visibly different from the ghost (phase-goal.md L80).

**How to check:** In blue placement mode, left-click a tile. A solid, fully-opaque cyan emissive unit should appear and remain on the tile after the mode returns to idle. Repeat for red. The committed units should look clearly "heavier" than the ghost — no translucency, stronger emissive presence.

---

When all boxes are ticked, record the date and operator name below, then the build loop can close the phase.

- Operator: Jaco
- Date: 2026-04-18
