---
id: energy-nodes-reskin
opened_at: 2026-04-19T04:25:00Z
priority: P0
status: done_by_engineer
---

# Energy nodes — real meshes on the grid, palette-compliant

## Outcome
Green spheres go away. Energy nodes become **floor-embedded hex platforms**
with a soft warm-white / pale-cyan glow that matches the Tron palette instead
of fighting it. Nodes read as **part of the grid** (tile-aligned footprint,
flush with the plane) rather than as floating gumballs above it.

When a worker of either faction eventually stands on a node, the node's
glow will shift to that faction's colour (cyan or red-orange). Workers don't
exist yet as real units, so for this task the **faction-hold glow is wired
through the test hook only** — the real rendering just renders the neutral
state.

This fixes the last big `palette` blocker (green → within palette) and ticks
the `Energy nodes` MVP checklist item.

## Acceptance
- New `src/energy-node.ts` module exposing a `buildEnergyNode(tileX, tileY)`
  factory that produces a single node mesh at the given grid coordinate,
  sitting **flush** with the grid plane (no vertical offset; tiles are
  `Y=0`). Geometry is a short hex prism (or octagonal prism) — definitely
  not a sphere — with a thin emissive rim around the top face. Body colour:
  near-charcoal with low emissive; rim colour: warm-white (`#e8f2ff`) or
  pale-cyan (`#9ceaf4`) — whichever reads more neutral against the grid.
  Rim emissive intensity ≥ 0.8 so it haloes through bloom.
- The existing 4 node positions are placed from a single source of truth
  (e.g. `NODE_POSITIONS` in `src/energy-node.ts`). MVP says "4+ nodes
  distributed on the grid" — pick 4 sensible positions (e.g. mid-edges of a
  central diamond pattern) and document them with a one-line comment if
  the positions aren't self-explanatory.
- `src/scene.ts` pre-places the nodes in the real game path, same way
  HQs are pre-placed. The `?e2e=1` hook stops seeding its green-sphere
  placeholders in any scene — it delegates to `createScene()`.
- Expose `node.setFactionHold(faction | null)` on each node mesh. When
  called with `'blue'`, shift the rim emissive to cyan `#00e0ff`; with
  `'red'`, shift to red-orange `#ff4a1a`; with `null`, reset to neutral.
  Add a `window.__vylux.setNodeHolds({ [nodeIndex]: faction })` setter
  so scene specs can drive it.
- Update the `early-economy` scene spec to set two nodes to blue-held and
  one to red-held before screenshotting, so the screenshot shows the
  faction-hold colouring live. Leave `idle-start` and `mid-combat`
  neutral (though `mid-combat` should be invited to hold 1–2 nodes under
  each faction for realism — your call, whatever looks like mid-combat).
- Unit tests for `energy-node.ts` cover: factory creates a Mesh+rim pair,
  default rim colour, `setFactionHold` mutates rim colour to the right
  value for each faction and resets on `null`.
- Regenerate `pm/screenshots/{idle-start,early-economy,mid-combat}.png`
  via `npm run scenes` and commit. The green spheres must be gone from all
  three; neutral nodes appear flush with the grid.
- Verify passes (lint + type + unit + all Playwright projects). Commit to
  local `main`.

## Constraints
- Do **not** touch `pm/mvp.md`, `pm/persona.md`, `pm/rubric.md`, or
  `pm/backlog.yaml` — PM-owned.
- Do not rework HQs, HUD, bloom, camera framing, workers, raiders, or
  combat. Scope is energy nodes + their test-hook setter only. Even if a
  one-line HUD fix would help, defer.
- Keep the node-hold colour palette limited to `#00e0ff` (blue),
  `#ff4a1a` (red), and the neutral warm/pale choice you picked — no green,
  no purple, no magenta.
- No `git push`.

## Handoff

- `src/energy-node.ts` added: short hex prism (6-segment cylinder) with a pale-cyan (`#9ceaf4`) rim disc sitting flush at Y=0.04. `setFactionHold` shifts the rim to `#00e0ff` (blue), `#ff4a1a` (red), or resets to neutral on `null`. `NODE_POSITIONS` is the single source of truth for the 4 tile positions: `[5,5]`, `[14,5]`, `[5,14]`, `[14,14]`.
- `src/scene.ts` updated: nodes pre-placed by `createScene()` (same pattern as HQs), exposed as `energyNodes: EnergyNodeBundle[]` on `SceneBundle`. Green sphere seeding removed from `e2e-hook.ts`.
- `window.__vylux.setNodeHolds({ [nodeIndex]: faction })` wired through `e2e-hook.ts` and typed in `debug.ts`.
- `early-economy` spec: nodes 0 and 1 held by blue, node 3 held by red. `mid-combat` spec: nodes 0 and 2 held by blue, node 3 held by red. `idle-start` stays neutral.
- Screenshots regenerated: `pm/screenshots/{idle-start,early-economy,mid-combat}.png`. No green in any of them. All 19 E2E + 120 unit tests green.
- Commit SHA: `ebcf9e1`
- Caveat: node 0 at tile (5,5) is close to the blue HQ corner (0,0) — may want to reposition to e.g. (6,6) if it visually crowds the HQ silhouette once real worker meshes exist.
