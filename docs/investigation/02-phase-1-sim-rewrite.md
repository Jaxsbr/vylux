# Investigation 02 — Phase 1 Sim Rewrite

> **Status:** ⚠️ Open — sub-phases 1.0–1.6 landed; **1.7 (input depth) outstanding before Phase 1 truly closes**
> **Phase:** 1 (Sim Rewrite)
> **Owner:** Jaco
> **Created:** 2026-04-26
> **Time-box:** target 4–8 weeks of focused work; revisit if it slips past Phase 0+1 ≤ ~2 quarters (PRD §2)

---

## Why this exists

PRD §8 Phase 1: _"Port the prototype's gameplay (HQ, workers, energy, three units) onto the new deterministic sim. **No new features, just the same game on the new spine.** Exit: prototype-equivalent gameplay against a placeholder AI, replays work, ranked-quality determinism proven offline."_

Phase 0 proved the determinism contract holds in TypeScript with fixed-point math. Phase 1 takes that proof and turns it into something playable. By the end, the game on `npm run dev` is **the same prototype Jaco was reviewing two weeks ago**, but running on the deterministic sim, with replays, and with the cross-OS gate still green on every push.

Phase 1 is **not where the new game design lands.** The two-resource economy, building-gated tech, partial fog of war, and the rest of PRD §6 — those are Phase 3. The discipline this round is "preserve the prototype shape, change the spine."

## Scope

### In scope

- **Combat sim.** HP, attack range (squared-distance), attack cooldown, auto-target-nearest-enemy-in-range, death + entity removal.
- **Three unit types.** Worker (eco, no combat), Defender (frontline, slow, high HP, short range), Raider (harass, fast, low HP, attacks workers/HQ). Same role triangle as the prototype.
- **Training.** `TrainUnit` command, energy cost-deduct, spawn at HQ-adjacent tile with deterministic tile selection.
- **Scripted AI.** Tick-driven build order (workers → defenders → raiders, send raiders at enemy HQ at thresholds). No RNG required — the prototype had none, and this preserves that.
- **Points + win condition.** Node control + kills + HQ damage accrue points; first to a fixed threshold wins. The literal numbers are tunable; the _shape_ matches the prototype.
- **Renderer integration.** Three.js scene reads `sim.state` between ticks and interpolates positions. Sim runs at 20 Hz; renderer at vsync. This is where PRD §3.3 (render/sim split) lands in real code.
- **Mouse-driven input.** Click HQ → buildables panel → click tile to place trained unit. Mouse-only is fine for Phase 1; keyboard parity (PRD §3.8) is Phase 3+.
- **Replay format + CLI harness.** A JSON replay format with version + seed + spec + input frames. A `tools/replay.ts` runner that consumes a replay and emits hashes. Save on match end.
- **Retire prototype code.** Delete `src/worker.ts`, `defender.ts`, `raider.ts`, `combat.ts`, `advance.ts`, etc. once the new sim covers their behavior. Update `AGENTS.md` to reflect the new structure.

### Out of scope (deferred to later phases)

- Two-resource economy (Phase 3, PRD §6.3).
- Partial fog of war (Phase 3, PRD §6.2).
- Building-gated tech / production buildings (Phase 3, PRD §6.4).
- Asymmetric factions (Phase 3, PRD §3.6).
- Keyboard parity, control groups, camera bookmarks, smart-cast (Phase 3+, PRD §3.8 + §6.9).
- Multiplayer transport, lobbies, NAT/relay (Phase 2).
- Steam wrapper, achievements, ladder (Phase 4).
- Replay sharing, observer mode, broadcast overlays (Phase 5).

### Out of scope (forever, unless re-pitched)

- Returning to wall-clock-driven sim ticks. The fixed-tick loop is the contract.
- Adding `Math.random()`, `Math.sqrt`, or floating-point math to any code under `src/sim/`.
- Renderer writing back into `src/sim/` state. Read-only consumer or it's broken.

## Sub-phases (rough sequence)

This is a working order, not a Gantt chart. Each sub-phase ends with the cross-OS CI gate still green and a commit on `main`.

### 1.0 — Combat + units in sim

Add `Defender` and `Raider` entity types alongside `Worker`. HP fields, attack damage, range (Q16.16, compared via `distSq`), attack cooldown ticks. Targeting: scan all entities of the opposing faction, pick nearest in range with stable tiebreaker (lowest entity ID). Death removes entity (`alive=false`).

Tests extend the determinism gate: a scripted match where one Raider walks toward a Defender, attacks, both die — committed as a new golden fixture.

**Exit:** sim has functional combat. The 12,000-tick golden fixture (which currently has no combat) is augmented with a combat scenario.

### 1.1 — Training command + scripted AI

`TrainUnit { faction, kind }` command; cost lookup from a `UnitConfig`. Spawn placement: deterministic search in tile order around HQ. AI: a small `aiTick(state, faction)` function that emits commands based on `state.tick` and faction state — same idea as the prototype's `ai.ts`, but pure and deterministic.

**Exit:** a sim-only headless match against the AI runs to a winner state without divergence.

### 1.2 — Win condition + match end

Points accrual per tick (node-control points + kill points + HQ-damage points). Match ends when any faction's points cross the threshold OR an HQ is destroyed. State has a clear `winner: Faction | null` field.

**Exit:** the headless AI-vs-AI match terminates with a winner. Replays of the match reproduce the same winner.

### 1.3 — Replay format + headless CLI harness

A JSON format: `{ version: 1, seed, spec, frames: [...] }`. Save on match end (initially: print to console / write to disk). `tools/replay.ts` (vite-node entrypoint): load a replay, run sim, emit hash stream, optionally diff against a golden hash file.

This sub-phase upgrades the determinism artifact from "vitest-only" to "shareable JSON file." Both stay valid.

**Exit:** can save a replay from a real match (even if recorded headless), can replay it via the CLI, hash stream matches the live run.

### 1.4 — Renderer integration

Build a new `src/render/` module that reads from `Sim` and renders. Three.js scene with the prototype's existing visual language: charcoal tile grid, neon HQs, unit silhouettes, simple HP bars. Sim ticks at 20 Hz on a `setInterval`-style fixed driver; renderer uses `requestAnimationFrame` and interpolates entity positions between the previous and current sim tick.

This is the make-or-break sub-phase for the render/sim split. Keep `src/sim/` untouched; if anything in `src/render/` reaches into sim state mutably, that's a bug in the design, not a workaround.

**Exit:** `npm run dev` shows a live game running on the deterministic sim, visually equivalent to the prototype.

### 1.5 — Mouse input layer (partial — see 1.7)

Pointer events → input frames. Click HQ → buildables panel → click tile → `TrainUnit` + `PlaceUnit` commands queued for the next tick. Reuse the prototype's `placement.ts` state machine pattern (which is already pure and renderer-agnostic) where it cleanly fits.

**Exit:** a fresh match is playable mouse-only against the AI, end to end, on the dev server.

**What actually shipped in commit `bb465f5`:** the buildables panel exists at the bottom of the screen and clicking a button trains the unit at the player's HQ. **Click-to-place at a tile, click-to-select a unit, and click-to-move a worker were deferred** without a strong-enough flag at the time. The result: the player can pick _what_ to train but has no spatial agency. This is a real shortfall against the criterion above and is closed by sub-phase 1.7 below — Phase 1 is **not** closed until that lands.

### 1.6 — Retire prototype code

Delete files no longer reached: `src/worker.ts`, `defender.ts`, `raider.ts`, `combat.ts`, `advance.ts`, `economy.ts`, `points.ts`, `match.ts`, `training.ts`, `node-points.ts`, `worker-task.ts`, `worker-harvest-pulse.ts`, etc. — plus any tests that exclusively cover them. Keep what's reusable (e.g. `placement.ts` if still useful, `grid.ts` constants, `hud.ts` if mouse-input layer leans on it).

Rewrite `AGENTS.md` to describe the new module layout: `src/sim/` (deterministic), `src/render/` (Three.js, read-only), `src/input/` (mouse → commands), `src/main.ts` (orchestration).

**Exit:** repo has only the new sim-driven code path. `npx tsc --noEmit && npm test && npm run test:e2e` passes.

### 1.7 — Restore input depth (the actual Phase 1 close)

This sub-phase exists because 1.5 shipped a partial input surface. The criterion in §"Success criteria" #1 explicitly says "the player can train **+ place** units mouse-only." That second half didn't land; this is where it does.

**Goal:** the player has the same spatial agency they had in the prototype — pick a tile to spawn at, pick a worker, pick a node — running on the deterministic sim.

**Concrete additions:**

1. **Click-to-place training.**
   - Click a panel button → renderer enters _placement mode_ (cursor changes, ghost mesh appears at the hovered tile in the player's faction colour).
   - Click a valid tile → `TrainUnit { faction, kind, x, y }` command queued. Insufficient energy or invalid tile (occupied, out of bounds, enemy territory if the design ever calls for it) → silent reject + visual flash.
   - Press Esc / right-click / click off-grid → exit placement mode.
   - Reuse the **shape** of the prototype's `placement.ts` state machine (the file itself was deleted in 1.6, but the pattern — pure transitions, discriminated-union outcomes, identity-preserving no-ops — is the right one). Build a fresh, smaller version that knows about the new `Faction = 0 | 1` types and the sim's tile-coord conventions.
   - Sim change: `TrainUnit` command gains optional `x, y` fields. When provided, spawn at the given tile instead of the HQ. When absent, current behaviour (spawn at HQ) is preserved so AI/test paths don't break.

2. **Click-to-select a unit.**
   - Raycast canvas pointer → tile or unit mesh.
   - Click on a unit you own → unit becomes "selected" (renderer-only state, not sim state — selection is per-player and doesn't affect determinism).
   - Selection ring mesh appears under the selected unit.
   - Esc / click empty space → deselect.

3. **Click-to-move/assign a selected worker.**
   - With a worker selected, click on a live energy node → `AssignWorkerToNode { workerId, nodeId }` command queued. (This command already exists in the sim from 1.0.)
   - With a worker selected, click on an empty tile → for now, no-op (Phase 3 may add free movement). Document the choice.
   - The auto-assign helper from 1.1 stays as a fallback for _idle_ workers (`phase=='idle'` with no target). The player's manual assignment overrides it for the duration of that worker's task; auto-assign only fires again when the worker becomes idle without a target. This matches PRD §6.3's "assignment matters and idle workers are a real problem."

4. **HQ click → contextual panel** (stretch).
   - The always-visible bottom panel becomes contextual: hidden by default, opened by clicking your own HQ. Closed by clicking off the HQ or pressing Esc.
   - Defer if running tight on time — always-visible works, this is UX polish, not depth.

5. **Visible HP bars on units + selection ring.**
   - Small thin mesh attached above each unit, scaled by `hp / maxHp`, coloured by faction.
   - Selection ring: ring/torus around the selected unit's base.

**Sim-layer changes (small, additive):**

- `TrainUnit` command grows `x?: number; y?: number` for tile-targeted spawns.
- No new commands for selection/move-worker — `AssignWorkerToNode` already covers it.
- Possibly a `MoveUnit { unitId, targetX, targetY }` if Phase 3 design ever calls for free movement; Phase 1.7 deliberately scopes that out.
- All four golden fixtures regenerate (state hash format changes when `TrainUnit` grows fields that flow into spawn coords).

**Renderer-layer changes:**

- New `src/render/input.ts` (or extend `player-input.ts`) with the placement state machine + selection state.
- Raycaster setup against tile meshes + entity meshes.
- Ghost-mesh rendering during placement mode.
- Selection-ring mesh + HP-bar mesh per unit.
- Cursor management (`canvas.style.cursor` flips during placement).

**Tests:**

- Vitest unit tests for the placement state machine (pure transitions, identity-preserving no-ops — the prototype's `placement.test.ts` is the model).
- Vitest unit tests for `TrainUnit` with tile coords (spawn at tile, occupancy reject, out-of-bounds reject).
- E2E: extend `mouse.spec.ts` (or split into `place.spec.ts` + `select.spec.ts`) to click-to-place a worker on a specific tile and assert it spawned there, then click-select-and-assign a worker to a node.

**Exit (the real Phase 1 close):**

A fresh match is playable mouse-only against the AI, **with full prototype-equivalent spatial agency**: click train → click tile → unit appears there. Click worker → click node → worker harvests there. Match plays through to victory/defeat. Cross-OS determinism gate stays green.

## Success criteria — the Phase 1 exit gate

Phase 1 closes — and Phase 2 (multiplayer alpha) is unblocked — when **all** of the following hold:

| # | Criterion | Status |
|---|---|---|
| 1 | Playable end-to-end on the dev server: fresh match opens with the Tron grid + both HQs, the player can **train + place** units mouse-only, AI plays back, combat happens, someone wins, "Play Again" resets in place. | ⚠️ Partial — train works, place does not (closed by 1.7). |
| 2 | Cross-OS determinism gate stays green on Linux + macOS + Windows. | ✅ |
| 3 | Replay round-trip via `tools/replay.ts` reaches the same final hash. | ✅ |
| 4 | Sim runs at 20 Hz with full visuals, no dropped ticks. | ✅ |
| 5 | Prototype code retired; only the sim-driven path survives in `src/`. | ✅ |
| 6 | Player has spatial agency comparable to the prototype: click-to-place trained units, click-to-select a unit, click-to-assign a worker to a node. | ⏳ Pending — sub-phase 1.7. |

## Risks — ranked

1. **Determinism regression during the rewrite.** Adding combat/AI/training is exactly when subtle non-determinism creeps in (e.g. iteration order over a built-up Set, string keys in a Map, an accidental `Math.random()` for tiebreaking). Mitigation: every sub-phase extends the golden fixture; CI catches drift on every push. Do not push a sub-phase until its determinism test exists.
2. **Renderer scope creep.** Tempting to polish: animations, smooth easing, effects. Discipline: Phase 1 visual bar is _prototype-equivalent_. Anything that smells like §6 (Phase 3 design) gets explicitly punted.
3. **Prototype code coupling.** `main.ts` + `placement.ts` + `worker.ts` + `combat.ts` are tangled; cutting them loose without breaking E2E tests is non-trivial. Mitigation: build the new path alongside the old one (`?sim=v2` query flag, or a separate entry point) and swap when sub-phase 1.5 lands. Don't try to do an in-place rewrite.
4. **Replay format versioning.** What ships in 1.3 is the format we're going to look at six months from now. Bake in `version: 1` from day one and write a forward-compat note in the format spec.
5. **20 Hz sim cadence under variable wall clock.** A long render frame must not stall the sim. The standard fix is "sim catches up by running multiple ticks per render frame, capped at N to prevent spiral-of-death." Mitigation: implement the catch-up loop in the driver from sub-phase 1.4, with a cap of ~5 ticks/frame and a warning log when capped.
6. **Match-end replay edge cases.** A replay recorded right at match end must include the final tick that decided the match. Mitigation: write the input log _after_ the winner is determined, not at "stop recording."

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-26 | Phase 1 scope locked to "prototype-equivalent on new spine," no PRD §6 features. | PRD §8 is explicit; the §6 game design is Phase 3. Mixing scopes here would slip both phases. |
| 2026-04-26 | Build the new sim-driven game path alongside the old one; swap at sub-phase 1.5, retire old at 1.6. | In-place rewrites of tangled prototype code historically slip. Parallel path keeps `main` shippable. |
| 2026-04-26 | Replay format = `{ version: 1, seed, spec, frames[] }`, JSON, no binary encoding. | Phase 1 needs the format to exist, not to be small. Binary/compressed comes in Phase 4 alongside Steam Cloud + sharing. |
| 2026-04-26 | Sub-phase 1.7 added; Phase 1 not closed at 1.6 as previously claimed. | 1.5 shipped buildables-panel-only — click-to-place at a tile, click-to-select a unit, and click-to-assign a worker were deferred without a strong-enough flag. The Phase 1 mandate (and the success-criterion #1 in this doc) explicitly required spatial input. Cataloguing the gap as 1.7 here ensures it doesn't get forgotten when Phase 2 work begins. |

## Open questions (need decisions during, not before, Phase 1)

- **Tick rate: 20 Hz or 30 Hz?** Default 20 Hz for now — matches PRD §7 target, lower bandwidth in Phase 2, easier to land 20 Hz solid than 30 Hz wobbly. Revisit if movement looks choppy after interpolation; 30 Hz is a config flip.
- **Should the renderer be its own scene?** Almost certainly yes (`src/render/` as a sibling to `src/sim/`), but the right granularity (one big module vs. per-entity render adapters) is a question that gets answered by writing the first version.
- **Worker harvest model in Phase 1: prototype's "stand on node" or PRD §6.3's "deposit-based"?** The prototype was stand-on-node; the deterministic sim already implements deposit-based (Phase 0 work). Phase 1 keeps deposit-based — it's already there, it's already tested, and PRD §11 explicitly cuts the stand-on-node model. This is the one tiny way Phase 1 _is_ the new game already.
- **AI difficulty?** Prototype was a single fixed AI. PRD §5 promises 3–4 difficulty tiers at launch. Phase 1 ships **one** difficulty (medium-ish, matching the prototype). The other tiers are content work for Phase 3 onward.
