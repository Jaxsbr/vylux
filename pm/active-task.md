---
id: worker-legibility
opened_at: 2026-04-19T09:30:10Z
status: done_by_engineer
priority: P0
---

# Worker behaviour legibility — consistent anim + readable harvest tick

## Outcome

From the player's perspective: blue and red workers behave identically.
When a worker is not on an energy node it sits still (no random
jitter). When a worker is on an energy node there is a clear visual
cue that ties to the harvest/income tick — a brief pulse, beam, or
scale tween fires on each `NODE_INCOME` tick so the player can see
"this worker is actively harvesting right now". The current red
up/down random-looking motion is gone or redefined as the harvest
tick itself and reads that way. A cold-start player can tell from a
single screenshot whether a worker is idling or harvesting.

## Acceptance

- Blue workers and red workers share **the same** idle and harvest
  visuals — no faction-specific motion logic. Only the faction color
  (cyan vs red-orange) differs.
- Off-node workers are static: no bob, no jitter, no sway. Full stop.
- On-node workers visibly pulse on every `NODE_INCOME` tick. Choose
  one and stick to it:
  - (a) a short scale-up-then-down tween on the worker mesh (e.g.
    1.0 → 1.15 → 1.0 over ~180ms), **or**
  - (b) a brief emissive/edge-pulse on the worker's accent mesh
    (e.g. emissiveIntensity spike and decay over ~180ms), **or**
  - (c) a short beam/line segment between the worker and the node
    that fades over ~180ms.
  Whatever you pick, the pulse must be tied 1:1 to the income tick
  fired by `economy.ts` — not a free-running animation clock.
- Pure animation module with unit tests (e.g.
  `src/worker-harvest-pulse.ts` + `.test.ts`): pure function taking
  elapsed-since-tick + tick duration → scale/intensity factor. No
  Three.js in the unit tests.
- Wiring in the animate loop hooks the pulse state to the actual
  `NODE_INCOME` fire event for any worker currently on a node.
- Playwright spec `tests/e2e/worker-legibility.spec.ts`:
  1. Seed a match. Spawn one blue worker off-node and one blue
     worker on an energy node (via `window.__vylux` — extend hooks
     if needed, justify in handoff).
  2. Advance time ~0.5 s with `advanceTime(0.05)` repeated. On each
     sub-step, sample the worker's current scale/emissive-intensity
     via a small hook (justify).
  3. Assert: the off-node worker's sampled values never vary beyond
     epsilon. The on-node worker shows non-trivial variation that
     peaks within the first ~200ms after a `NODE_INCOME` tick.
  4. Fail if the off-node worker moves at all, or if the on-node
     worker never pulses.
- Regenerate `pm/screenshots/early-economy.png` so the on-node
  harvest visual is visible in the frame (if the harvest pulse is
  transient, capture at a moment where at least one worker's pulse
  is near its peak — use a deterministic seed via the scene runner
  if needed).
- Existing Playwright specs must still pass (mouse-end-to-end,
  offensive-reach, idle-loses, tooltips, onboarding-cue).

## Constraints

- Do not change worker **movement** behaviour (selection + tile-hop
  click-to-move stays identical). Only idle / on-node visuals
  change.
- Do not change the economy tick rate or `NODE_INCOME` value.
- Do not introduce particle systems, post-processing effects, or
  sound. Stick to mesh tweens / emissive changes / thin line
  segments.
- Both factions must share the same code path. No `if
  (faction === 'red')` branches in the animation logic.
- Do not touch the other reopen-2 siblings (`event-feedback-pulses`
  is still separate — it's for place / death / capture / point-tick
  events, not harvest).
- Do not regress `pm/rubric.md` v2 thresholds (no hard-fails).

## Handoff

### Pulse option chosen: emissive spike (option b)

Rationale: the Tron palette already drives readability through emissive accents —
making the worker's equatorial ring "flare" on each income tick is consistent with
the visual language and reads clearly in a static screenshot without relying on
the viewer being able to see motion. Scale tweens are subtle from the isometric
camera angle; the emissive spike lights up the bloom pass noticeably.

Pulse curve: fast linear attack (0 → peak in 17% of duration ~30ms) then
quadratic decay back to baseline over the remaining ~150ms. Total duration 180ms.
Base accent emissiveIntensity = 2.0; peak = 5.0 (+3.0 delta).

### NODE_INCOME wiring

`economy.ts::tickEnergy()` only used `BASE_INCOME` — `NODE_INCOME` was exported
but never applied to energy. Added `tickEnergyWithNodes()` (pure, tested) that
accepts a `NodeWorkerCount` per faction and adds `NODE_INCOME * count * dt` on
top of `BASE_INCOME`. Both `main.ts` animate loop and `e2e-hook.ts::advanceTime`
now count how many workers each faction has on held energy nodes and use this
function. `tickEnergy()` is unchanged (still used by existing tests).

The discrete pulse trigger uses a per-worker fractional accumulator: accrues
`NODE_INCOME * dt` each frame; when it crosses 1.0 `triggerHarvestPulse()` is
called and the accumulator wraps. This gives one pulse every `1/NODE_INCOME`
seconds (0.5s with NODE_INCOME=2). Off-node: accumulator is reset to 0 and no
pulse fires.

### New `window.__vylux` hooks (both require `?e2e=1`)

- `getWorkerPulseElapsed(index)` — seconds since last pulse trigger, -1 if not
  pulsing. Index is into `bundle.workers` (all factions, spawn order).
  Justified: Playwright needs to assert whether a pulse is active without
  importing Three.js.
- `getWorkerAccentIntensity(index)` — current `emissiveIntensity` of the accent
  ring material. Justified: same; avoids any Three.js in test assertions.

### Files touched

- `src/worker-harvest-pulse.ts` — new: pure curve functions
- `src/worker-harvest-pulse.test.ts` — new: 12 unit tests
- `src/economy.ts` — added `tickEnergyWithNodes`, `NodeWorkerCount`
- `src/economy.test.ts` — added 4 tests for `tickEnergyWithNodes`
- `src/worker.ts` — refactored `buildDiamondMesh` to return `accentMat`;
  added `triggerHarvestPulse`, `tickPulse`, `pulseElapsed`, `accentEmissiveIntensity`
  to `WorkerBundle` type + implementation
- `src/debug.ts` — added `getWorkerPulseElapsed?` and `getWorkerAccentIntensity?`
  to `VyluxHook`
- `src/e2e-hook.ts` — wired `tickEnergyWithNodes`, harvest pulse ticking in
  `advanceTime`; added `getWorkerPulseElapsed` and `getWorkerAccentIntensity`
  to `E2EHookExtension` and `attachE2EHook`
- `src/main.ts` — replaced `energyLedger.tick()` with `tickEnergyWithNodes`;
  added `workerHarvestAcc` WeakMap; added harvest pulse trigger + `tickPulse`
  calls in animate loop
- `playwright.config.ts` — added `worker-legibility.spec.ts` to dev testMatch
- `tests/e2e/worker-legibility.spec.ts` — new: 5 e2e tests
- `pm/screenshots/early-economy.png` — regenerated: captured at 530ms into the
  match (0.5s advance + 0.03s peak-attack step) so at least one on-node worker
  is at peak emissive during the screenshot frame

### Verify

`npx tsc --noEmit && npm run test && npm run test:e2e` — fully green.
288 unit tests. 74 e2e tests.

### Commit SHA

`965b010`
