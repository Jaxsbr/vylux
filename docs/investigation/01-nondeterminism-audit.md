# Investigation 01 — Non-determinism audit of `src/`

> **Status:** Complete (initial pass)
> **Phase:** 0, Step 1 (per `00-determinism-and-netcode.md`)
> **Date:** 2026-04-26

---

## TL;DR

The prototype is **more deterministic than expected**. There is no `Math.random()`, no `Math.atan2`, no `parseFloat`/`parseInt`-driven sim values, and no obvious iteration-order hazards on `Object.keys`. The real offenders cluster around two axes:

1. **Wall-clock-driven time** — every per-frame sim mutation flows from `performance.now()` deltas through `Math.min((now - lastTime) / 1000, 0.1)`. This is pervasive but trivially replaced by a fixed-tick driver.
2. **`Math.sqrt` in combat/targeting distance checks** — five sites use Euclidean distance to make state-affecting decisions (which target to attack, whether a worker can reach a node). Cross-platform sqrt is _almost_ deterministic on IEEE-754 hardware, but cross-language / WASM-vs-JS engines disagree at the bit level. This is where Phase 0 will earn its keep.

Estimated work to make the existing sim deterministic, **without rewriting the gameplay**: 1–2 days for time, 1 day for distances, ½ day for the `Map<string, ...>` cleanup. The new sim core (Step 2) replaces all of this with deterministic primitives anyway, so the existing offenders are documented for reference, not for in-place fixing.

## Findings, ranked

### 1. Wall-clock-driven sim time — `src/main.ts:655–905+`

```ts
let lastTime = performance.now();
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const deltaSeconds = Math.min((now - lastTime) / 1000, 0.1);
  // ...all sim ticks fed deltaSeconds...
}
```

`deltaSeconds` is then threaded into:

- `tickEnergyWithNodes(..., deltaSeconds)` (income)
- `node.tickRegen(deltaSeconds)`
- `w.tick(deltaSeconds)` / `d.tick` / `r.tick` (every unit's behaviour, including position interpolation, attack cooldowns, harvest progress)
- `tickPlacementPulse`, `tickDamagePulse`, `tickDeathPulse` (visual but some affect lifetime → state)
- `VISUAL_PULSE_RATE * deltaSeconds` accumulators

**Verdict:** every state-affecting mutation in the prototype flows through a wall-clock delta. This is the single biggest source of non-determinism in the codebase. Replacement: fixed-tick loop with constant `dt` (e.g. 1/20s for 20 Hz). The renderer keeps `requestAnimationFrame` and interpolates between sim states; the sim does not see wall-clock time at all.

### 2. `Math.sqrt` in combat targeting and reachability checks

Five sites compute Euclidean distance and make state-affecting decisions on the result:

| File | Line | Use |
|---|---|---|
| `src/worker-task.ts` | 121 | Worker → node distance for path planning |
| `src/advance.ts` | 47 | Raider → target distance |
| `src/defender.ts` | 253 | Defender → enemy distance for attack range |
| `src/worker.ts` | 382 | Worker → ? distance |
| `src/raider.ts` | 246 | Raider → target distance for attack range |

```ts
const dist = Math.sqrt(dx * dx + dy * dy);
```

**Verdict:** `Math.sqrt` is IEEE-754 specified, so identical hardware + identical JS engine = identical result. Cross-engine (V8 vs JavaScriptCore vs SpiderMonkey) is _usually_ identical for sqrt specifically, but not _guaranteed_, and WASM/Rust ports may differ in the last bit. **Cheaper fix: don't take the sqrt at all.** Compare squared distances to squared ranges:

```ts
const distSq = dx * dx + dy * dy;
if (distSq <= rangeSq) { /* in range */ }
```

This is exact integer math when `dx, dy` are integers (Q16.16 fixed-point in the new sim). The only reason to materialise sqrt is for display, and display is the renderer's job.

### 3. `requestAnimationFrame` driving sim work directly — `src/main.ts:658`

The sim does not have its own loop; it's a passenger on `requestAnimationFrame`. Variable frame rates (vsync at 60 Hz vs 120 Hz vs 144 Hz) feed different `deltaSeconds` to the sim, producing different state. This is a special case of #1.

**Verdict:** the new sim drives itself. The render loop calls `sim.advance(wallClockMs)` which internally runs zero or more fixed-tick `step()` calls to catch up. Rendering interpolates between the latest two sim states.

### 4. `new Map<string, WorkerTask>` — `src/main.ts:65`

```ts
const workerTasks = new Map<string, WorkerTask>();
```

Worker tasks keyed by string (likely `"x,y"` tile coords). JS spec guarantees insertion-order iteration on `Map`, so this is _technically_ deterministic — but only as long as insertion order is itself deterministic. Cross-engine differences in async scheduling could in principle reorder inserts. More importantly, the new sim should not rely on string keys for entity identity at all; it uses array-indexed entity IDs (cache-friendly + bit-stable serialisation).

**Verdict:** noted; replaced wholesale in the new sim.

### 5. `new Set<string>` for adjacency checks — `src/training.ts:109–116`

```ts
const set = new Set<string>();
for (const u of units) { /* set.add(...) */ }
for (const h of hqTiles) { /* set.add(...) */ }
for (const [nx, ny] of NODE_POSITIONS) { /* check */ }
```

Used to compute "occupied tiles" before checking placement validity. Set iteration is insertion-order, and this set is rebuilt fresh each call so order is determined by argument order. Likely fine, but the new sim uses a flat occupancy bitset over the grid — O(1) lookup, no string allocation, trivially deterministic.

**Verdict:** noted; replaced.

## False positives (looked like non-determinism, are not)

These showed up in the grep but are not problems:

- **`Math.PI`, `Math.sin`, `Math.cos` in `src/scene.ts`, `src/grid.ts`, `src/hq.ts`, `src/energy-node.ts`, `src/worker.ts`, `src/defender.ts`, `src/raider.ts`** — all renderer-only (mesh rotation, ring geometry, camera positioning). The renderer is allowed to do floating-point math; only the sim must be deterministic.
- **`Date.now()` in `src/main.ts:1089`** — only used in a `webglcontextlost` log line. Not sim.
- **`setTimeout` in `src/buildables-panel.ts:99,242` and `src/scene.ts:450,461`** — UI feedback debouncing. Not sim.
- **`requestAnimationFrame` in `src/e2e-hook.ts:335,336`** — test harness for "wait for two frames." Not sim.
- **`forEach`, `for...of`, `Object.keys`** — ubiquitous, but every observed use iterates over arrays or freshly-built collections. No iteration over external objects with engine-defined ordering.
- **No `Math.random()` anywhere in `src/`.** Confirmed via direct search. The prototype's "AI" is fully scripted on tick counters, not RNG. This is a pleasant surprise — when the sim moves to a seeded PRNG, there is no existing call site to migrate.

## What this means for Step 2

The new sim core can be built **next to** the existing prototype, not on top of it. Specifically:

- **Time** is owned by a new `Sim.step()` driver; the prototype's `deltaSeconds` plumbing is irrelevant to the new code.
- **Distances** are computed in fixed-point integers; squared comparison only. No sqrt in sim hot paths.
- **Entity storage** is array-indexed with stable IDs; no string-keyed maps.
- **The renderer** keeps every existing pattern (Three.js math, `requestAnimationFrame`, `Math.sin/cos` for camera) — those are not regressions, they're correctly on the render side of the sim/render boundary.

When Phase 1 ports gameplay onto the new sim, the existing prototype files will be progressively retired or rewritten, but they are not part of the deterministic gate.

## Open follow-ups (not blockers)

- **Trig functions in sim?** RTSes generally don't need them — directions are integer-cardinal or 8/16-direction lookup, distances are squared. If a future feature genuinely needs `sin/cos` (e.g. circular AoE rotation), we add a Q16.16 lookup table at that point. Not building one preemptively.
- **Cross-language sqrt parity** — if the sim ever moves to WASM (Rust path), we revisit. For now, sqrt is banned from sim regardless.
- **JS `Math.fround` semantics** — only relevant if we use `Float32Array` in sim. We won't (fixed-point integers), so moot.
