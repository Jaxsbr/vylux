# Vylux

## Purpose

A 3D isometric real-time strategy game — an Age of Empires-like builder inspired by the novel and movie *Tron*. Players compete for resources on a neon-contrasting grid (red-orange vs. blue on dark), building, gathering, sabotaging opponents, and racing toward supremacy.

## Stack

- **Language:** TypeScript (strict mode, `noUnusedParameters`, `noUnusedLocals`)
- **Rendering:** Three.js 0.170 (orthographic isometric camera, charcoal background, Tron-style neon grid)
- **Build / dev server:** Vite 5.4 — dev port 5180, preview port 5181
- **Unit tests:** Vitest 2.1 (pure `src/**/*.test.ts`)
- **E2E tests:** Playwright 1.48 with `dev` + `preview` projects (foundation + smoke + preview guard)

## Verify command

```
npx tsc --noEmit && npm run test && npm run test:e2e
```

This is the same command the build-loop test gate runs locally — no CI-only variants.

## Module layout (`src/`)

| Module          | Role                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------- |
| `placement.ts`  | Pure state machine. Owns `{ mode, selectedUnitType, hoveredTile, placedUnits }` and exports pure transitions (`handleKey`, `handlePointerMove`, `handleClick`, `tryPlace`) plus pure view helpers (`computeGhostView`, `computeHoverView`, `hoverColorFor`, `ghostEmissiveFor`, `isTileOccupied`). No imports from `input.ts` or `scene.ts`. |
| `input.ts`      | Thin dispatcher. Listens for `keydown` (window) and `pointermove` + `pointerdown` (canvas), calls pure transitions on `placement.ts`, and flips the canvas cursor. Exposes `attachInputHandlers()` with a `detach()` callback that unbinds all three listeners. No scene mutations. |
| `scene.ts`      | Three.js scene + orthographic camera + lights + `raycastCenter` + `raycastPointer`. Reads current state via `bundle.reconcile(state)` on every frame and updates hovered tile tint, ghost mesh position/visibility/emissive, and lazily spawns placed-unit meshes for new entries in `state.placedUnits`. |
| `grid.ts`       | `buildGrid()` produces 400 tile meshes + 42 divider strips, plus `tileToWorld(tileX, tileY)` for coordinate lookup. `GRID_CONSTANTS` is the single source of truth for grid size and tile color. |
| `debug.ts`      | Dev-only (`import.meta.env.DEV`) hook. Attaches `window.__vylux` with a getter-based `debug` snapshot rebuilt on every access (`buildDebugSnapshot(bundle)`). Stripped from production builds — Playwright asserts `window.__vylux === undefined` on the preview server. |
| `main.ts`       | Orchestration. Creates the scene, attaches the debug hook, wires `attachInputHandlers` with `getState`/`setState`, runs the per-frame `reconcile + render` loop, and handles `webglcontextlost` by flipping `bundle.contextLost.current` and logging via `console.error`. |

## Placement state machine

Shape owned entirely by `placement.ts`:

```ts
type PlacementState = {
  mode: 'idle' | 'placement';
  selectedUnitType: 'blue' | 'red' | null;
  hoveredTile: { tileX: number; tileY: number } | null;
  placedUnits: Array<{ tileX: number; tileY: number; type: 'blue' | 'red' }>;
};
```

Pure transitions (current state + event -> next state):

| Transition                                 | Meaning                                                               |
| ------------------------------------------ | --------------------------------------------------------------------- |
| `handleKey(state, key)`                    | `1`/`2` enter placement + select faction; `Esc` returns to idle.      |
| `handlePointerMove(state, hit \| null)`    | Tracks `hoveredTile`; `null` clears it. Same-coord returns same ref.  |
| `handleClick(state, hit, button)`          | Non-left button or non-placement mode: same ref. Null hit: exit idle. Otherwise delegates to `tryPlace`. |
| `tryPlace(state, tileX, tileY)`            | Discriminated union `{ ok: true, state } \| { ok: false, reason, state }` — guards occupied / out-of-bounds / not-in-placement. |

Return-value convention: every transition returns the **same reference** for no-ops and a **fresh object** for real changes. Dispatchers short-circuit on identity (`next === current ? skip : setState(next)`).

## State-ownership contract (load-bearing)

- `src/placement.ts` owns all mutable state. Transitions are pure functions — no side effects, no I/O.
- `src/input.ts` is a thin dispatcher. It never imports from `src/scene.ts` and never mutates scene objects directly. Enforced at compile time via module boundaries.
- `src/scene.ts` reads state via the per-frame `reconcile(state)` pull model. It never imports from `src/input.ts` and never writes to `placement.ts` state. Enforced by convention + `src/source-scan.test.ts` (which additionally scans every `catch (` for `throw` or `console.error`).
- `window.__vylux` exists only when `import.meta.env.DEV` — it is a read-only mirror of `placement.ts` state plus a live `debug` snapshot for Playwright assertions. Production builds strip it; a Playwright test on the preview server asserts `window.__vylux === undefined`.

## Quality checks

- no-silent-pass
- no-bare-except
- error-path-coverage
- agents-consistency
