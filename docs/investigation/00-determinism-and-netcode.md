# Investigation 00 — Determinism & Netcode Spike

> **Status:** Open — not started
> **Phase:** 0 (gates Phase 1)
> **Owner:** Jaco
> **Created:** 2026-04-25
> **Time-box:** 2 weeks of focused work

---

## Why this exists

Section 3.1 of the PRD makes determinism a load-bearing pillar. Replays, lockstep multiplayer, observer mode, server-side anti-cheat, balance telemetry — all of them collapse if the simulation is not bit-reproducible across machines.

This is the **single most important architectural question on the project**, and it must be answered before any feature work resumes. Retrofitting determinism into a non-deterministic sim is a rewrite. Building deterministically from the start is a constraint.

Two weeks. If the answer is "yes, we can do this in TypeScript," Phase 1 begins. If the answer is "no, JS floating point and engine assumptions defeat us," we re-evaluate the language for the sim layer (most likely a Rust-compiled-to-WASM sim with a TypeScript renderer on top).

## What we are trying to prove

A claim, in plain English: **two instances of the Vylux client, given the same starting state and the same sequence of input frames, produce the same state on every tick — bit for bit — for at least 10 minutes of simulated play.** Across operating systems where launch is targeted (Windows + macOS), and across reasonable variations in hardware.

This is a yes/no question. Either we can do this, or we cannot. We are not optimising. We are not picking a network library. We are answering one question.

## Success criteria (the gate)

The spike is "done" — and Phase 1 is unblocked — when **all** of the following are true:

1. **Bit-identical state hashes.** Two clients (same OS, then cross-OS) running the same input log produce identical SHA-256 hashes of the sim state every tick for a 10-minute scripted match.
2. **Replay round-trip.** A replay file produced by a live match plays back to the same final state hash. Pause/resume during playback does not affect the hash.
3. **Desync detection.** A deliberately-corrupted input on one client is detected within one tick (state hash mismatch) and surfaces a useful diagnostic (which entity, which field, which tick).
4. **Cross-OS stability.** The above holds when client A is on macOS and client B is on Windows, on the same architecture (x86_64 or arm64 — not mixing).
5. **Performance headroom.** The sim alone (no rendering) runs at >=10x real-time on a developer laptop. We need this for fast replay scrubbing and for headless server-side validation later.

If 1–3 pass on a single OS but 4 (cross-OS) fails, that's still informative — it likely points at a JS engine or platform library issue and tells us whether the JS-sim path is viable.

## Out of scope for this spike

These are real problems but **not what we are answering this round**:

- Network transport (WebRTC vs WebSocket).
- Lobby, matchmaking, or session management.
- NAT traversal and relay servers.
- Reconnection and rollback.
- The actual game design (units, economy, win conditions).
- Render quality, art, animation.
- Any Steam integration.

Bringing any of these in widens the spike past its time-box. Park them.

## Approach (in rough order)

The spike is structured to fail fast. Each step is a checkpoint where we decide: continue, pivot, or abort.

### Step 1 — Map the current sim's non-determinism (1–2 days)

Read every file under `src/` and tag every source of non-determinism. Expected offenders, ordered by likelihood:

- `Math.random()` calls (RNG without a seed).
- `performance.now()` / `Date.now()` driving sim logic.
- `requestAnimationFrame` callbacks doing sim work directly (variable `delta`).
- Floating-point arithmetic on positions, distances, HP — anything affecting state.
- `Math.atan2`, `Math.sin`, `Math.cos`, `Math.sqrt` inside the sim.
- Iteration order over `Map` / `Set` / object keys (engine-defined).
- Any DOM or rendering call inside the sim path.
- Any external library used inside the sim (Three.js Vector3 math is the suspected big one).

Output: a markdown list under this file with file/line for each. This list is the work backlog for Step 2.

### Step 2 — Build the deterministic sim core (4–6 days)

Carve out a new module — call it `src/sim/` — that the renderer reads from but never writes to. Inside it:

- **Fixed-point numeric type.** Q16.16 is the default starting point (32-bit int, 16 bits integer / 16 bits fractional). Implement add, sub, mul, div, sqrt, sin/cos via lookup table.
- **Seeded PRNG.** A small, fast, well-tested PRNG (xoshiro128** or splitmix64). Single instance per match, seeded from match seed.
- **Fixed-tick loop.** A `Sim.step(inputFrame)` function that is pure: same `(state, inputs) → state'` every time. The render loop calls `step()` zero or more times per frame to catch up to wall-clock.
- **Stable iteration.** All sim collections are arrays (or sorted-key iteration). No iterating over `Object.keys()` for state-affecting work.
- **State hash.** A function that produces a SHA-256 over a canonical serialization of the sim state. Used for determinism checks.

The sim does not need to be the full game. It needs **enough mechanics to be exercisable**: workers moving on a grid, harvesting, training units, basic combat. A subset of the prototype, ported deterministically.

### Step 3 — Headless harness (1–2 days)

Build a Node.js (or `vite-node`) harness that:

- Loads a recorded input log (JSON: `{ seed, input_frames[] }`).
- Runs the sim headless for the recorded duration.
- Emits a state hash every tick.
- Diffs two runs' hash streams and reports the first divergence with context.

This is the test harness for the gate. It is also the prototype of the eventual server-side replay validator.

### Step 4 — Cross-machine validation (2–3 days)

Run the harness on:

- The same machine, twice. (Trivial check.)
- macOS arm64 and macOS x86_64. (Architecture sanity.)
- macOS and Windows. (The real test.)

Each run consumes the same input log. Hashes are compared offline.

A single divergent tick fails the spike for that pair until fixed. Most failures will trace back to Step 1's list — either a non-determinism we missed or a platform-specific quirk (e.g. `Math.fround` semantics, denormals).

### Step 5 — Two-tab P2P sanity test (1–2 days)

Open two browser tabs in the same browser. Drive them with a synthetic "input relay" using `BroadcastChannel`. Each tab runs the sim independently against the shared input stream. Confirm hashes match every tick for a 10-minute scripted match.

This is **not** a real network test. It is the "is the JS engine itself deterministic enough" check, with all transport variables removed. If this fails, real WebRTC will fail harder.

## What "no" looks like and what we do then

If after two weeks any of the success criteria are unattainable:

- **JS sim deterministic on one OS but not cross-OS.** Likely culprit: floating-point or transcendental functions. Pivot: drop FP entirely, use the lookup-table sin/cos and verify. If that still fails, consider WASM for the sim layer.
- **JS sim non-deterministic even on one machine.** Likely culprit: collection iteration, async ordering, or a missed `Math.random()`. Pivot: stricter discipline, possibly an ESLint rule + a custom AST scan. If unfixable, the JS-sim path is a dead end.
- **Performance below the 10x bar.** Pivot: sim → WASM for hot paths only. The rest of the architecture survives.

The decision to escalate to WASM is binary and made with Jaco. It is not assumed in advance.

## Deliverables

When this spike closes, the repo contains:

- `src/sim/` — a deterministic sim module (subset of prototype gameplay).
- `src/sim/fixed.ts`, `src/sim/rng.ts`, `src/sim/hash.ts`, `src/sim/step.ts` — the primitives.
- `tools/replay-harness.ts` — the headless runner.
- `tests/determinism/` — a Vitest suite that asserts hash equality across runs and against a checked-in golden log.
- This document, updated with: outcome, what worked, what didn't, the platform divergence findings, and a recommendation for Phase 1.

## Decision log

(Append as the spike progresses.)

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-25 | Spike opened, time-boxed to 2 weeks. | PRD §3.1 makes determinism load-bearing; cannot start Phase 1 without this answered. |
