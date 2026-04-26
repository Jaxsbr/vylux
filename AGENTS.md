# Vylux

## Purpose

A Tron-inspired isometric real-time strategy game, designed from the ground up to be **deterministic, replayable, and competitively spectated**. See `docs/product/PRD.md` for the product direction; this file describes how the code is laid out.

## Stack

- **Language:** TypeScript (strict mode, `noUnusedParameters`, `noUnusedLocals`)
- **Renderer:** Three.js 0.170 (orthographic isometric camera, charcoal background, Tron-style neon grid)
- **Build / dev server:** Vite 5.4 — dev port 5180, preview port 5181
- **Unit tests:** Vitest 2.1
- **E2E tests:** Playwright 1.48 (`dev` + `preview` projects)

## Verify command

```
npx tsc --noEmit && npm run test && npm run test:e2e
```

Same gate the CI determinism workflow runs (`.github/workflows/determinism.yml`) on Linux + macOS + Windows. The cross-OS leg validates against the committed golden hash fixtures in `tests/determinism/`.

## Architecture: two layers, one direction

```
                    ┌─────────────────────────┐
                    │      src/main.ts        │   orchestration
                    └────────┬────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
   reads sim state                          submits commands
        │                                         │
        ▼                                         ▼
┌───────────────────┐  ◄─── reconcile ──── ┌───────────────────┐
│   src/render/     │                      │     src/sim/      │
│ Three.js scene,   │                      │   deterministic   │
│ mesh adapters,    │                      │   simulation      │
│ fixed-tick driver │                      │   (Q16.16, RNG,   │
│ (read-only)       │                      │    hash, step)    │
└───────────────────┘                      └───────────────────┘
```

**Load-bearing rule (PRD §3.3):** `src/render/` reads from `src/sim/`. It never writes back. The sim is the single source of truth; the renderer is a one-way consumer. Enforced by convention + module boundaries.

## Module layout

### `src/sim/` — deterministic simulation (no Three.js)

| File              | Role |
| ----------------- | ---- |
| `fixed.ts`        | Q16.16 fixed-point arithmetic. Add/sub via int32 wraparound; mul/div via BigInt to dodge int32-truncation on intermediate products. `distSq` + `rangeSq` for sqrt-free range checks. |
| `rng.ts`          | splitmix64 PRNG with BigInt state. Seeded per match; snapshot/restore for replays. No `Math.random()` anywhere in sim. |
| `hash.ts`         | FNV-1a 64-bit hasher. Sync, BigInt-backed. Used for tick-by-tick desync detection. |
| `types.ts`        | `SimState`, `Unit` (discriminated `Worker \| Defender \| Raider`), `EnergyNode`, `FactionState`. All state fields are integers or `Fixed`. |
| `units-config.ts` | Per-kind stats (HP, speed, attackRange, attackDamage, attackCooldownTicks, trainCost). Hoist target for Phase 3 difficulty tiers. |
| `commands.ts`     | Input commands consumed by the sim: `AssignWorkerToNode`, `SpawnUnit`, `TrainUnit`. Plain data, replay-safe. |
| `state.ts`        | Initial-state factory + entity-lookup helpers (linear scan; entity counts are small, iteration is cache-friendly). |
| `step.ts`         | One tick: apply commands → advance units (worker harvest loop, defender attack-in-range, raider march+attack-or-attack-HQ) → win check → bump tick + RNG. Sim freezes once `state.winner` is set so past-end frames stay deterministic. |
| `sim.ts`          | Public `Sim` class: state + step + `stateHash()` (canonical FNV-1a digest). |
| `ai.ts`           | Pure `tickAi(state, faction)` returning `Command[]`. Build order: workers → defenders → raiders. `autoAssignIdleWorkers` is exported separately so player-controlled factions get the same idle-worker convenience without the AI's training decisions. |
| `replay.ts`       | `Match` class wraps `Sim` and records every input frame. `ReplayLog` JSON format `{ version, spec, frames, finalHash, finalWinner }`. `playReplay` validates against the embedded final hash. |
| `scripted-match.ts` | Reusable test fixtures (harvest, combat, AI-vs-AI). Drives both Vitest gates and the committed golden hash files. |

### `src/render/` — Three.js scene (read-only consumer of sim state)

| File              | Role |
| ----------------- | ---- |
| `scene.ts`        | Three.js scene + orthographic isometric camera + lights + WebGL renderer. Pure setup; no sim references. `tileFloatToWorld(tileX, tileY)` converts fractional sim tile coords to Three.js world coords. |
| `meshes.ts`       | Per-entity mesh builders. Tron-style emissive geometry: HQ as edge-glowing cube, worker as cylinder, defender as box, raider as cone-on-base. Faction colours: cyan (faction 0), red-orange (faction 1). |
| `sim-renderer.ts` | `SimRenderer` class. Reconciles `sim.state` ↔ Three.js meshes. `capturePrev()` snapshots positions before each sim tick; `update(alpha)` lerps between previous and current state for smooth render-rate motion. Dead units kept around with `mesh.visible = false`. |
| `sim-driver.ts`   | Fixed-tick driver. `requestAnimationFrame` for both sim catch-up and rendering, capped at `MAX_STEPS_PER_FRAME=5` to prevent spiral-of-death after long pauses. Sim-frontend-agnostic — takes a `commandsForTick` callback. |
| `player-input.ts` | `PlayerInput` (buildables panel, queues `TrainUnit` commands on click, refreshes affordability from sim each frame) + `MatchEndOverlay` (VICTORY/DEFEAT screen; Play Again reloads the page). |

### `src/main.ts` — orchestration

Wires `Sim` → `Match` → `SimRenderer` → `startSimDriver`, plus `PlayerInput` (faction 0) and `tickAi` (faction 1). HUD overlay shows tick / winner / per-faction HP / points / energy / unit count / dropped sim steps.

### `src/grid.ts` — shared

Tile grid mesh + `tileToWorld(tileX, tileY)` helper. Used by `src/render/scene.ts`. Pure; no sim or input dependencies.

## Determinism contract

This is the single most load-bearing property of the codebase (PRD §3.1):

- **No `Math.random()`** anywhere under `src/sim/`. RNG goes through the seeded `Rng` instance.
- **No `Math.sqrt`, `Math.atan2`, `Math.sin`, `Math.cos`** in sim hot paths. Range checks use squared distance.
- **No `Date.now`, `performance.now`, `requestAnimationFrame`-driven mutations** in sim. The driver feeds a fixed `dt` per tick.
- **Fixed-point integer math** for any value that affects state. Floats are renderer-only.
- **Stable iteration**: arrays indexed by ID, tombstones (`alive=false`) on removal so live indices don't shift.
- **State hash** (`Sim.stateHash`) defines the canonical serialisation. Changing it invalidates all replays and golden fixtures.

The `tests/determinism/` directory contains committed golden hash sequences for four scripted matches (200-tick + 12,000-tick harvest, 1500-tick combat, 3000-tick AI-vs-AI). The CI workflow runs the same `npm test` on Linux + macOS + Windows; if any platform's V8 produces a different hash than the committed fixture, the workflow fails with the first divergent tick visible in the diff.

To regenerate the fixtures after intentional sim changes:

```
RECORD_GOLDEN=1 npm test
```

…then `git diff` to confirm the fixtures moved as expected, and commit.

## Tools

| Path                 | Role |
| -------------------- | ---- |
| `tools/replay.ts`    | Headless replay runner. `npx vite-node tools/replay.ts <replay.json> [--hashes-out <file>]` plays a recorded match deterministically and prints final tick / winner / hash. The optional flag dumps the per-tick hash stream as JSON for cross-OS comparison via `diff`. |

## Quality checks

- `src/source-scan.test.ts` — scans every `catch (` block for `throw` or `console.error` to catch silent-pass error handling. Generic across the whole `src/` tree.
- `tsc --noEmit` with `strict`, `noUnusedParameters`, `noUnusedLocals`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.
- Cross-OS determinism workflow on every push.
