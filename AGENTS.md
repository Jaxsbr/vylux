# Vylux

## Purpose

A Tron-inspired isometric real-time strategy game — single-player PvAI duel on a deterministic sim. The deterministic property is now valued for engineering reasons (save/load, replays-as-bug-reports, scripted scenarios, AI testing), not for esport-grade lockstep multiplayer.

See [`docs/plan.md`](docs/plan.md) for the product direction and phase plan. This file describes how the code is laid out. For the current in-game catalog (units, structures, resources, tech, controls), see [`docs/manual.md`](docs/manual.md).

The lockstep / WebRTC / observer multiplayer code under `src/net/` is **dormant** — preserved for optionality (see "Dormant code" below), but **not on the active surface**. Don't extend it without re-pitching.

## Mindset

**The game must be fun.** A good game loop matters more than feature count. When in doubt, strip down — three landed mechanics that work beat ten that don't. Don't extend the catalog ahead of the loop being fun on its current surface. The visual north star is [`docs/concepts/Isometric_3D_real-time_strategy_game_screenshot_Tron-inspired_9f371fa3-921d-4540-84e9-165734ff064b_2.png`](docs/concepts/Isometric_3D_real-time_strategy_game_screenshot_Tron-inspired_9f371fa3-921d-4540-84e9-165734ff064b_2.png); the planning anchor is [`docs/plan.md`](docs/plan.md).

## Documentation contract

`docs/manual.md` is the canonical "what is in the game right now" reference. It MUST be updated as part of any change that adds, removes, or re-tunes:

- a unit (`UnitKind`) — stats, cost, train time, role
- a structure (`StructureKind`) — HP, cost, build time, what it produces / hosts
- a resource (`ResourceKind`) — where it's gathered, what it's spent on
- a tech / research — cost, time, structure that hosts it, effect
- a victory or loss condition
- the controls (mouse / keyboard / panel)
- the launch map(s)

Any change touching the catalog must update `docs/manual.md` in the same change set. If `docs/manual.md` disagrees with `src/sim/units-config.ts` or any other code source-of-truth, the code wins — patch the doc, don't paper over the divergence.

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

**Load-bearing rule:** `src/render/` reads from `src/sim/`. It never writes back. The sim is the single source of truth; the renderer is a one-way consumer. Enforced by convention + module boundaries.

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

### `src/net/` — multiplayer transport _(DORMANT — see "Dormant code" below)_

> **Dormant.** This module is preserved end-to-end (compiles, tests pass, CI runs it) but is **not on the active product surface** post-pivot. The PvE direction does not need lockstep multiplayer. Don't add features here, don't extend the protocol, don't reference these classes from new product code. If you need to touch a file under `src/net/` for a non-trivial reason, that's a signal the pivot decision is being re-opened — surface it before changing anything.

| File                    | Role |
| ----------------------- | ---- |
| `lockstep-channel.ts`   | Typed lockstep transport. Three message kinds — `hello`, `frame` (per-tick per-faction commands), `hash` (per-tick `stateHash()` for cross-peer desync detection). Sits on top of any `BroadcastChannelLike` — `BroadcastChannel` for the same-machine determinism gate (Phase 2.0), `WebRtcTransport` for peer-to-peer (Phase 2.1+). **Canonical merge order is load-bearing**: `tryConsumeOrderedFrame` always returns `[faction0, faction1]` because `applyCommand` mutates `state.nextEntityId` in apply order — any divergence here desyncs by tick 1. |
| `lockstep-loop.ts`      | `LockstepLoop` class — owns the per-tick orchestration with input delay (default 6 ticks = 300 ms at 20 Hz, per Phase 2.2). Pre-seeds empty frames for ticks 0..D-1 on first `next()`, schedules local commands for tick `T+D`, submits hash for `T-1`, consumes merged frame for `T`. Used by both `BroadcastChannel` and WebRTC modes — single code path. |
| `observer-channel.ts`   | `ObserverChannel` — receive-only sibling of `LockstepChannel` for the Phase 2.5 observer role. Listens on any `BroadcastChannelLike`, accumulates `frame` messages by `(tick, faction)`, exposes `tryConsumeMergedFrame` in canonical order. No hello, no hash, no local faction. |
| `observer-loop.ts`      | `ObserverLoop` — drives the read-only sim from `ObserverChannel`. No input delay (the player-side delay is already baked into the relayed frames). |
| `signaling-protocol.ts` | Wire types shared between the signaling server and the WebRTC client. Confusable-free 6-character room code alphabet (`ABCDEFGHJKMNPQRSTUVWXYZ23456789` — no I/L/O/0/1) and `isValidRoomCode` validator. |
| `signaling-server.ts`   | `ws`-based WebSocket server. Pairs two clients by room code, blindly relays SDP + ICE. Goes dormant once the datachannel is up. Standalone Node.js process; not imported by anything in `src/main.ts`, so it stays out of the client bundle. |
| `webrtc-transport.ts`   | Client-side adapter. Wraps `RTCPeerConnection` + `RTCDataChannel`, speaks the signaling protocol over a WebSocket, implements `BroadcastChannelLike` so `LockstepChannel` is reused unchanged. Host creates the datachannel before the offer; trickle ICE both ways; outbound queue drains on datachannel-open. |

### `src/main.ts` — orchestration

Three run modes selected from URL params:
- default: PvAI. Player is faction 0 (cyan), AI controls faction 1.
- `?lockstep=host` / `?lockstep=join` (no room): same-machine two-tab lockstep over `BroadcastChannel`. Local determinism gate.
- `?lockstep=host&room=ABCDEF` / `?lockstep=join&room=ABCDEF`: peer-to-peer lockstep over WebRTC datachannel via the signaling server. Substrate-only swap; `LockstepChannel` is unchanged.

Wires `Sim` → `Match` → `SimRenderer` → `startSimDriver`, plus `PlayerInput` and `tickAi` (PvAI) or `LockstepChannel` (lockstep). For WebRTC mode, `WebRtcTransport.connect()` is awaited before the scene is built and a "connecting · room ABCDEF" overlay is shown until the datachannel opens. HUD overlay shows tick / winner / per-faction HP / points / energy / unit count / dropped sim steps; in lockstep mode it also shows peer connection + the latest *resolved* per-tick hash status (BroadcastChannel + WebRTC delivery are both async, so the most-recent tick is almost always still "pending" at render time).

### `src/grid.ts` — shared

Tile grid mesh + `tileToWorld(tileX, tileY)` helper. Used by `src/render/scene.ts`. Pure; no sim or input dependencies.

## Determinism contract

Post-pivot, this is no longer load-bearing for the *product* (no lockstep multiplayer to be the gate for) but it remains load-bearing for the *engineering*:

- **Save / load works for free** — a run is `(seed, scenario, command_log)`; no full-state serialisation needed.
- **Replays-as-bug-reports** — a player who hits weird behaviour exports the replay; we reproduce the exact run on our machine.
- **Scripted scenarios are reproducible** — wave 7 of the bottleneck scenario plays the same every time.
- **AI testing** — two AI variants race on the same seeds; outcome differences are signal, not noise.
- **Cross-OS regression catch** — the cross-OS CI workflow flags accidental float introductions early.

We don't go *out of our way* to add new uses of determinism, but we don't break the contract for convenience either — the cost has already been paid in Phases 0–3, and the engineering wins above are real. The rules below are unchanged from the pre-pivot text:

- **No `Math.random()`** anywhere under `src/sim/`. RNG goes through the seeded `Rng` instance.
- **No `Math.sqrt`, `Math.atan2`, `Math.sin`, `Math.cos`** in sim hot paths. Range checks use squared distance.
- **No `Date.now`, `performance.now`, `requestAnimationFrame`-driven mutations** in sim. The driver feeds a fixed `dt` per tick.
- **Fixed-point integer math** for any value that affects state. Floats are renderer-only.
- **Stable iteration**: arrays indexed by ID, tombstones (`alive=false`) on removal so live indices don't shift.
- **State hash** (`Sim.stateHash`) defines the canonical serialisation. Changing it invalidates all replays and golden fixtures.
- **`CommandKind` IDs are append-only — never reuse a slot, even after removal.** Each value in the `CommandKind` const enum corresponds to a wire-format byte; a v3 replay that contains `kind: 6` (the deprecated 3.1 `ResearchTier2`) must continue to parse without crashing under v4 even though no current command interface uses that slot. Removing a command means dropping its interface from the union and leaving the enum value behind as a reserved/dead slot — see `src/sim/commands.ts` header for the rule, and `ResearchTier2 = 6` for the worked example. Adding a command means picking the next unused number; never recycle.

The `tests/determinism/` directory contains committed golden hash sequences for four scripted matches (200-tick + 12,000-tick harvest, 1500-tick combat, 3000-tick AI-vs-AI). The CI workflow runs the same `npm test` on Linux + macOS + Windows; if any platform's V8 produces a different hash than the committed fixture, the workflow fails with the first divergent tick visible in the diff.

To regenerate the fixtures after intentional sim changes:

```
RECORD_GOLDEN=1 npm test
```

…then `git diff` to confirm the fixtures moved as expected, and commit.

## Tools

| Path                          | Role |
| ----------------------------- | ---- |
| `tools/replay.ts`             | Headless replay runner. `npx vite-node tools/replay.ts <replay.json> [--hashes-out <file>]` plays a recorded match deterministically and prints final tick / winner / hash. The optional flag dumps the per-tick hash stream as JSON for cross-OS comparison via `diff`. |
| `tools/signaling-server.ts`   | Standalone WebSocket signaling server for Phase 2.1+ multiplayer. `npm run signaling` (default port 5182). PORT/HOST env override. Deployable as-is to any Node.js host (Render / Fly / Railway). |

## Quality checks

- `src/source-scan.test.ts` — scans every `catch (` block for `throw` or `console.error` to catch silent-pass error handling. Generic across the whole `src/` tree.
- `src/net/lockstep-channel.test.ts` — Phase 2.0 same-state gate: drives two `Match` instances over paired in-process channels for 600 ticks of AI play; per-tick hashes must agree on every tick.
- `src/net/lockstep-loop.test.ts` — Phase 2.2 input-delay gate: same paired-sims setup but driven through `LockstepLoop` at the production `INPUT_DELAY_TICKS = 6`; pre-seed warm-up + 600-tick hash agreement.
- `src/net/signaling-server.test.ts` — Phase 2.1 signaling-relay gate: real `ws` clients pair, exchange opaque signal payloads, and observe peer-left on disconnect.
- `tests/e2e/lockstep.spec.ts` — browser form of the 2.0 gate: two tabs at `?lockstep=host` / `?lockstep=join` reach matching hashes via `BroadcastChannel`.
- `tests/e2e/lockstep-webrtc.spec.ts` — browser form of the 2.1 gate: two tabs negotiate WebRTC through the local signaling server and reach matching hashes via the datachannel on loopback.
- `tests/e2e/lockstep-desync.spec.ts` — Phase 2.3 gate: one tab corrupted via `?desync-test=N` causes the desync overlay to surface on both tabs within ~1 s of the divergent tick.
- `tests/e2e/lockstep-replay.spec.ts` — Phase 2.4 gate: replay saved mid-match via R key round-trips through `playReplay()` to the same final hash.
- `src/net/observer-channel.test.ts` — Phase 2.5 three-sim gate: host + join + observer reach identical per-tick hashes for 600 ticks.
- `tests/e2e/lockstep-observer.spec.ts` — Phase 2.5 browser gate: three tabs (`?lockstep=host`, `=join`, `=observe`), observer's HUD reports `both factions live` and ticks within ~5 of the players.
- `tsc --noEmit` with `strict`, `noUnusedParameters`, `noUnusedLocals`, `noImplicitReturns`, `noFallthroughCasesInSwitch`.
- Cross-OS determinism workflow on every push.
