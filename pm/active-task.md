---
id: unit-training
opened_at: 2026-04-19T04:47:35Z
priority: P0
status: done_by_engineer
---

# Unit training — HQ-selection + Q/W/E hotkeys + defender/raider meshes

## Outcome
Players produce their army. Selecting the blue HQ and pressing `Q`, `W`,
or `E` trains a **worker**, **defender**, or **raider** respectively,
instantly spawning the new unit adjacent to the HQ and deducting its cost
from the blue energy ledger. Insufficient energy = no spawn, no deduction,
no crash. This ticks the `Unit training` MVP item and delivers two new
unit classes (`defender`, `raider`) with distinct Tron-style silhouettes,
which the upcoming combat + AI tasks will rely on.

## Acceptance
- New `src/defender.ts` module:
    - `buildDefender(faction, tileX, tileY)` → `DefenderBundle` same shape
      as `WorkerBundle` (`{ mesh, setTile, moveTo, tick }`).
    - Mesh: squat octagonal or hexagonal prism (wider + shorter than a
      worker — reads as "slow tank") with faction-coloured emissive and
      edge trim. Clearly different silhouette from both worker and HQ.
    - Movement uses the same straight-line tile-hop at a **slower** speed
      (`DEFENDER_SPEED ≈ 1.2 tiles/s`).
- New `src/raider.ts` module:
    - `buildRaider(faction, tileX, tileY)` → `RaiderBundle` same shape.
    - Mesh: elongated angular blade / wedge (tall, narrow, pointed) with
      faction-coloured emissive and edge trim. Fastest silhouette — reads
      as "assault".
    - Movement at `RAIDER_SPEED ≈ 2.8 tiles/s`.
- Cost constants come from a single shared `src/units-config.ts` (or add
  them to an existing shared constants file — your call). Values:
    - `WORKER_COST = 20`
    - `DEFENDER_COST = 60`
    - `RAIDER_COST = 100`
- HQ selection:
    - Left-click raycasting extended so a left-click on the **blue HQ**
      mesh selects it (exposes a single new selection kind — "hq" or
      "worker" — in `src/selection.ts`, with a shared selection-ring
      rendering that's cyan on both).
    - Clicking a red HQ deselects.
    - Selecting the HQ deselects any currently-selected worker.
- Keyboard training (only when blue HQ is selected):
    - `Q` → attempt `trainUnit('worker')`.
    - `W` → attempt `trainUnit('defender')`.
    - `E` → attempt `trainUnit('raider')`.
    - Lowercase `q`/`w`/`e` also work. Other keys ignored.
- Training flow (`src/training.ts` is a fine home):
    - Look up the unit cost from `units-config.ts`.
    - Check the blue energy ledger — if the blue balance ≥ cost, deduct
      via `economy.subtractEnergy('blue', cost)` (add the helper if
      missing — must clamp at 0, not allow negative).
    - Pick a free adjacent tile to the blue HQ (walk the 8 neighbours of
      tile (0,0), skipping tiles occupied by existing worker / defender /
      raider / node / HQ). If **no** adjacent tile is free, the training
      silently fails (no deduction, no spawn) — this is rare at match start.
    - Build the correct unit (`buildWorker` / `buildDefender` /
      `buildRaider`) and register it with the scene + game loop so
      `tick(dt)` is called each frame.
- Test-only hook additions:
    - `window.__vylux.selectHq(faction)` — deterministically select a
      faction HQ for scene/spec-driven test flows.
    - `window.__vylux.pressTrainKey(key)` — fires the corresponding
      training key as if typed. Forward to the same handler used by real
      keyboard input.
    - `window.__vylux.getUnitCount({ faction, kind })` — read-side helper
      for assertions.
- Unit tests:
    - `defender.ts` / `raider.ts` — same shape as `worker.test.ts`
      (mesh + move + tick). Include faction-colour emissive assertions.
    - `training.ts` — given a mocked or real energy ledger, training with
      insufficient energy is a no-op; training with enough energy deducts
      and registers a new unit; training when no adjacent tile is free
      fails silently.
- Playwright coverage: one new spec `tests/e2e/training.spec.ts` that:
    - Sets blue energy to 200 via `setEnergy`.
    - Calls `selectHq('blue')` → `pressTrainKey('q')` → asserts worker
      count increased by 1 and energy dropped by `WORKER_COST`.
    - Repeats for `w` (defender) and `e` (raider).
- Scene spec updates:
    - `early-economy` calls the hook to spawn 1 defender per faction near
      each HQ, so the scene shows the new silhouette.
    - `mid-combat` calls the hook to spawn 3 raiders per faction in a
      contested cluster near the red HQ, replacing any remaining
      placeholder "raider" boxes.
- Regenerate `pm/screenshots/{idle-start,early-economy,mid-combat}.png`
  via `npm run scenes` and commit. Committed screenshots should show:
    - `early-economy`: workers + 1 defender per faction.
    - `mid-combat`: real raider meshes stacked near red HQ.
- Verify passes (lint + type + unit + all Playwright projects). Commit to
  local `main`.

## Constraints
- Do **not** touch `pm/mvp.md`, `pm/persona.md`, `pm/rubric.md`, or
  `pm/backlog.yaml` — PM-owned.
- Do not implement combat, HP bars, auto-attack, projectiles, AI, or
  win/lose. Even if the defender mesh naturally wants a "range"
  attribute, do not wire any combat logic.
- Do not implement the `NODE_INCOME` worker multiplier. Energy ledger
  behaviour is unchanged apart from the `subtractEnergy` helper.
- Instant training is fine for MVP — no build queue, no progress bar.
- Keep Q/W/E strictly gated on "blue HQ is the current selection". Do not
  let the hotkeys work globally.
- No `git push`.

## Handoff

Commit: `eae91a5`

- **Defender mesh** — squat octagonal prism (`CylinderGeometry` 8 radial segments, wide base 0.38, height 0.28) with a narrowing cap dome on top. Reads as slow tank vs. worker diamond. DEFENDER_SPEED = 1.2 t/s.
- **Raider mesh** — triangular blade (`CylinderGeometry` 3 segments) tapering wide-to-narrow at the base, then continuing to a spike via a stacked second cone. Reads as fast/aggressive. RAIDER_SPEED = 2.8 t/s. Both use faction emissive + EdgesGeometry trim — same visual language as worker and HQ.
- **HQ selection** — `src/selection.ts` now holds a discriminated union `'none' | 'worker' | 'hq'`. Left-click on blue HQ calls `selectHq()` (shows cyan ring under HQ tile); left-click on red HQ calls `clearSelection()`. HQ ring is a `THREE.RingGeometry` added to the HQ group in `hq.ts`.
- **Training flow** — `src/training.ts` is pure: `trainUnit()` checks energy ≥ cost, calls `findFreeNeighbour()` on the 8 neighbours of (0,0) (skipping occupied units, HQ tiles, and nodes), returns `{ ok, spawnTile, newEnergy }`. `main.ts` wires scene mutation. Q/W/E keydown gated on `getSelectedHq()?.faction === 'blue'`; `pressTrainKey()` hook applies same gate.
- **Hook additions** — `selectHq(faction)`, `pressTrainKey(key)`, `getUnitCount({ faction, kind })` all live in `e2e-hook.ts`. `getUnitCount` reads from `bundle.workers`, `bundle.defenders`, `bundle.raiders`.
- **Scene specs** — `early-economy` now spawns real defender meshes (1 per faction near each HQ). `mid-combat` now spawns real raider meshes (3 blue raiders + 2 red defenders) replacing former placeholder boxes.
- Screenshots regenerated: `pm/screenshots/idle-start.png`, `pm/screenshots/early-economy.png`, `pm/screenshots/mid-combat.png`.
- Caveat: free-neighbour check at HQ (0,0) has only 3 in-bounds candidates in the corner — with 2 starters already there, training more than 1 unit requires at least one starter to be away. E2E `three-in-sequence` test pre-moves starters to demonstrate this gracefully.
