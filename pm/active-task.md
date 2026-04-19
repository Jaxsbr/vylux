---
id: worker-task-loop
opened_at: 2026-04-20T20:03:25Z
status: done_by_engineer
priority: P0
---

# Worker task loop — walk → harvest → return → offload; one-per-node; exhaustible; neutral node visuals

## Outcome

The player (or the AI) assigns a worker to a live energy node. The
worker walks to the node, sits on it, and **harvests into a visible
local buffer over a short window** (animated fill — the player can
*watch* the worker harvest). When the buffer is full, the worker
walks back to its faction HQ, **offloads** into the faction energy
pool (HUD energy number flashes on offload), and then returns to the
same node to do it again. If the node is exhausted by the time the
worker returns, the worker auto-seeks the nearest live node.

Energy nodes are **exhaustible** (finite reserve). Nodes read as
**neutral / unclaimed** at idle — white-core hex with a faint
neutral glow — and only tint toward blue / red while a faction worker
is actively harvesting them. An exhausted node reads as visibly dead
(dim, no tint, no glow pulse). At most **one worker per node**;
second worker pathing to an occupied node re-targets to the nearest
live unoccupied node (prefer re-target over wait).

This replaces the "stand on tile → passive tick" passive economy
with a visible, strategisable task loop. The economy source is still
node → energy; it's just routed through the worker's round-trip.

## Acceptance

- **Worker task state** — each worker carries a task enum at minimum:
  `idle | walking-to-node | harvesting | walking-to-hq | offloading`.
  Transitions are driven by the tick loop; visible in tests.
- **Assignment** — the player assigns a blue worker to a node by
  selecting the worker and clicking a live, unoccupied node. The AI
  uses the same underlying assignment API (wire through `ai.ts`).
  Existing click-to-move on empty tiles still works for workers that
  aren't currently on a task — so moving a worker manually cancels
  its task.
- **Harvest buffer animation** — during the `harvesting` phase the
  worker shows a visible fill / pulse that reads as "filling up" over
  the configurable `HARVEST_DURATION` seconds (tune so 3–5s feels
  right). On buffer full, the worker triggers an event feedback pulse
  consistent with the existing event-feedback-pulses work, then
  transitions to `walking-to-hq`.
- **Offload** — on reaching the HQ tile (or any tile in the HQ's
  proximity zone — engineer's call, pick what looks best), the worker
  increments the faction's energy pool by `HARVEST_YIELD` (tune so
  one full round-trip yields a number that makes the loop feel worth
  it; start around 5–10). HUD energy number flashes on offload.
- **Exhaustible nodes** — each node carries a `reserve: number`
  initialised to a sensible constant (e.g. 50–80 units). Each
  successful offload drains the reserve by `HARVEST_YIELD`. When
  `reserve <= 0` the node enters `exhausted` state: visibly dim,
  unpickable as a harvest target, no glow pulse.
- **Neutral node visuals** — node meshes at idle read as white-core
  with a faint neutral glow (no blue or red tint). Only tint toward
  the harvesting worker's faction colour while a worker is in the
  `harvesting` state on that node. On worker leaving / node being
  exhausted, tint fades back to neutral (or dead for exhausted).
- **One worker per node** — each node carries an
  `occupiedBy: workerId | null` field. `assignWorkerToNode` refuses to
  path a second worker onto an occupied node; instead it auto-targets
  the nearest live unoccupied node (or leaves the worker idle with a
  brief HUD feedback message if there are none).
- **Auto-reassign on exhaustion** — a worker whose node exhausts
  mid-task (either because its own harvest drained it or another
  worker drained it from elsewhere) walks to the nearest live
  unoccupied node. If none exist, it stops near the exhausted node
  and goes idle.
- **AI wiring** — red AI workers use the new task model and look
  identical behaviourally to blue workers. No AI rewrite beyond
  swapping its assignment calls to the new API. `idle-loses-tuning`
  must remain green — the AI still outproduces a player who does
  nothing.
- **Unit + e2e coverage** — task state machine (walking / harvesting /
  walking-to-hq / offloading), exhaustion, one-per-node refusal with
  re-target, auto-reassign on exhaustion, energy-pool offload, neutral
  vs harvesting node tint. Add a Playwright scene that captures a
  mid-harvest frame showing a worker with a visible fill buffer on a
  blue-tinted node.
- **Follow-up cue fix (from v14 scoring)** — `early-economy` scene
  still shows the onboarding cue despite the previous task's claim
  that it was fixed. Extend the cue-dismissal hook so the scripted
  seed used by `tests/e2e/scenes/early-economy.spec.ts` dismisses the
  cue (or update that scene to call the existing dismissal hook
  before screenshotting). Regenerated `early-economy.png` must NOT
  contain the onboarding cue. `idle-start.png` must still contain it.
- **Regenerate screenshots** — all committed `pm/screenshots/*.png`
  regenerated, including a new `harvest-loop.png` (or similar) showing
  a worker mid-harvest with the fill buffer visible. Existing regs
  (`mouse-e2e-victory`, `idle-loses-end`, `walled-hq-spawn`) stay
  green.

## Constraints

- Mouse-only input. Do NOT add a keyboard shortcut for assigning a
  worker to a node.
- Do NOT introduce A*. Keep straight-line tile-hop movement. The
  existing mover is fine even with longer round-trips; if it surfaces
  a bug under the round-trip pattern, fix the bug but do not rewrite.
- Do NOT rewrite the combat system, points, AI build-order shape, or
  placement / proximity / spawn-point systems. This task is strictly
  the worker economy loop + node model + their visuals.
- Do NOT change `GRID_SIZE`, `WIN_POINTS`, faction colours, or the
  left/right HQ layout. You may tune `BASE_INCOME`, `NODE_INCOME`
  (likely set to 0 or near-zero now that harvest is the income
  source), `HARVEST_YIELD`, `HARVEST_DURATION`, and node `reserve`
  defaults to keep `idle-loses-tuning` green. Log the new constants
  in `pm/mvp.md`'s constants table when done.
- Keep existing `placement.ts` helpers as-is; add a new module for
  worker task state (`src/worker-task.ts` or similar) rather than
  bloating `worker.ts`.
- Keep the existing buildables panel and HUD layout untouched apart
  from whatever is needed for the offload flash and the HUD feedback
  for "no live nodes" / "node occupied" messages.
- This is the biggest reopen-3 task. Ship in clean, committable
  chunks internally if you want; final commit to local `main` only
  when the full acceptance list is green.

## Handoff

Commit SHA: f5cf6cc

Shipped the full worker task loop. New module `src/worker-task.ts` owns the pure state machine (`idle | walking-to-node | harvesting | walking-to-hq | offloading`) with `tickWorkerTask`, `assignWorkerToNode`, `cancelWorkerTask`, and `findNearestLiveUnoccupied`. Constants: `HARVEST_DURATION=4.0s`, `HARVEST_YIELD=8`, `RESERVE_DEFAULT=60`, `OFFLOAD_DURATION=0.5s`. `NODE_INCOME` set to 0 in `economy.ts`; passive income replaced by harvest round-trips. `VISUAL_PULSE_RATE=2` added for the on-node pulse animation (unchanged visually). Energy nodes got `reserve`, `occupiedBy`, `exhausted`, `setHarvestingTint`, `setHarvestFill` — neutral (white-core) at idle, faction-tint only during active harvest, dim when exhausted. Workers got `id`, `setHarvestFill`, `harvestFillProgress` plus a fill-ring mesh. AI wired to `assignWorkerTask` callback. E2E hook extended with 6 new helpers; `VyluxHook` in `debug.ts` updated. `worker-task-loop.spec.ts` added (9 tests) and registered in `playwright.config.ts`. Follow-up cue fix: `early-economy` spec calls `dismissOnboardingCue` before screenshotting. All 355 unit tests + 90 e2e tests green.

Screenshots regenerated:
- `pm/screenshots/harvest-loop.png` (NEW — worker mid-harvest, fill buffer visible on blue-tinted node)
- `pm/screenshots/early-economy.png` (no onboarding cue)
- `pm/screenshots/idle-start.png`
- `pm/screenshots/idle-loses-end.png`
- `pm/screenshots/mouse-e2e-victory.png`
- `pm/screenshots/mid-combat.png`
- `pm/screenshots/walled-hq-spawn.png`
- `pm/screenshots/buildables-panel.png`
- `pm/screenshots/tooltip-buildables.png`
- `pm/screenshots/proximity-zone.png`
