# Vylux Manual

> **Audience:** anyone — players, internal alpha testers, agents, future-Jaco — who needs to know **what is currently in the game**, not the design vision behind it. The vision lives in [`plan.md`](plan.md); the in-progress design intent and phase plan live there too.

> **Currency:** this file MUST be updated as part of any change that adds, removes, or re-tunes a unit, structure, resource, tech, or victory condition. If the numbers in this file disagree with `src/sim/units-config.ts`, **the config wins** — patch this doc.

> **Phase C.1 (2026-05-12) landed:** work pods + worker per-unit charge + the first research item (auto-resume). Workers now spend 1 charge per task (harvest cycle or build). At 0 charge a worker enters charge mode (walks to the nearest friendly work pod, falls back to HQ if no pod exists) and refuses player commands until fully recharged. Each operational work pod also raises the worker cap, and hosts the worker auto-resume research. AI actively grows its workforce — it trains workers up to the cap and builds work pods to raise the cap further.

---

## Resources

| Resource | Source | Used for | Notes |
|---|---|---|---|
| **Energy** | Energy nodes scattered around the map. Workers gather → return → deposit at HQ. | Worker training, work pod construction. | The only live resource at this cut; **Matter** is the planned construction-material companion (Phase C.2 of `plan.md`). |

### Worker harvest model

Workers walk to a node, harvest for one *harvest interval* (per-faction — Swarm 23 ticks ≈ 1.15 s, Siege 17 ticks ≈ 0.85 s), pick up `HARVEST_AMOUNT` clamped by `WORKER_CAPACITY`, walk back to HQ, deposit, and resume. Workers don't trickle. Newly-trained workers stand idle on spawn and after each deposit until the player issues a command — auto-assign is removed from the player path so the player keeps agency over where workers go (the AI still auto-assigns its own faction).

### Worker charge (Phase C.1)

Every worker carries an internal `charge` meter (default max **10**, drains **1** per task at task-start). Movement is **free while charge > 0**; once charge hits 0, the worker enters **charge mode** and refuses every player command (move, harvest, build) until it has fully recharged.

**What counts as a task** (1 charge each, charged at start):
- One harvest cycle — `movingToNode → harvesting → returning → deposit at HQ`. One full cycle = 1 charge.
- One build action — `movingToBuildSite → building → operational`. 1 charge.
- Aborted tasks (player redirects mid-cycle, node depletes, build cancelled): **still cost a full charge**. Drain is at start, no refund.
- `MoveUnit` is free while charge > 0 (the worker has fuel to spare).

**Charge-spot picking:**
- Always prefer the **nearest friendly operational work pod**, regardless of distance.
- Fall back to the friendly **HQ** only if no operational pod exists.

**Recharge rates:**
- At a work pod: `+1 charge per 20 ticks` (~10 s to refill a full 10/10 tank).
- At HQ: `+1 charge per 40 ticks` (~20 s — half the pod rate).

**Renderer cues:**
- Cyan charge bar under each worker's HP bar.
- Floating lightning icon on a worker when the player tries to command it during charge mode. ~1 s fade.

### Vision + scouting

The renderer filters per faction. Friendly units, the friendly HQ, and friendly work pods are always visible; enemy entities are hidden until they enter the player's current vision bubble (no last-known-position memory in v1). Vision radii (in tiles): worker 4, HQ 8, work pod 5.

Resource nodes are discovered persistently — once a friendly unit / HQ / pod comes within vision of a node, the faction's `discoveredBy[node]` flag flips to true and stays true forever (no fog-of-war rediscovery). Each faction's home patch is auto-discovered at tick 0. Right-click-moving a worker is the canonical scouting action. Observer mode bypasses vision entirely (sees both factions' state).

---

## Units

| Kind | HP | Speed | Train cost | Max charge | Train time | Trained at |
|---|---|---|---|---|---|---|
| **Worker (Swarm)** | 30 | 0.055 | 40 E | 10 | instant | HQ |
| **Worker (Siege)** | 60 | 0.045 | 60 E | 10 | instant | HQ |

`E` = Energy. Speeds are tiles per sim tick (sim runs at 20 Hz; multiply by 20 for tiles/second).

**Faction asymmetry (Phase C.1 first cut):**
- **Swarm** workers are cheaper + softer + faster on the move, slower to harvest. Lean into volume.
- **Siege** workers are costlier + tougher + slower on the move, faster to harvest. Lean into staying power.
- Charge tank and recharge rates are identical across factions for this cut — divergence lands with the upgrade tree.

### Behaviour

- **Worker** — gathers from any live energy node, builds work pods, runs on its own internal charge meter. Cannot fight. Carrying is lost on death.

---

## Structures

| Structure | HP | Cost | Build time | Role |
|---|---|---|---|---|
| **HQ** | 250 (configurable per match) | — | — (placed at match start) | Trains workers. Losing it ends the match. Acts as a fallback charge spot at half the pod rate. Provides 5 worker cap. |
| **Work Pod** | 100 | 60 E | 30 ticks (1.5 s) | Built by a worker. While operational: +5 worker cap, and acts as a primary charge spot (faster than HQ). Hosts (future) worker-upgrade research — slot reserved, no upgrades yet. |

### Build flow (Work Pod)

1. Select one or more workers.
2. Click **BUILD WORK POD** on the action bar (hotkey **B**) — the cursor switches to crosshair.
3. Left-click a tile to commit the placement. The lowest-ID actionable worker is dispatched: it pays 1 charge, the faction pays 60 Energy, the pod spawns with full `buildTicksRemaining`.
4. The worker walks to the site (`movingToBuildSite`), arrives (`building`), and ticks the structure down (1 tick per sim tick while on site). At 0 ticks the pod becomes operational.
5. Build aborted (worker redirected, worker killed): the pod stays under construction; another worker can be dispatched to finish it (in C.1 only one worker constructs at a time — multi-worker construction lands in a follow-up).

### Capacity

- HQ baseline: **5** worker cap.
- Each operational work pod: **+5**.
- `TrainUnit` is silently rejected when `supplyUsed >= supplyCap`. Both values are recomputed at end of each sim step.

---

## Tech

Research is hosted at any operational work pod — pick one, click **RESEARCH AUTO-RESUME**. Faction-level slot (not per-pod): once started, every other pod shows the in-progress state, and on completion every owned worker reads the flag.

| Research | Cost | Time | Effect |
|---|---|---|---|
| **Auto-Resume** | 80 E | 80 ticks (4 s) | Workers automatically resume their previous harvest task after charging. Without it, a worker that finished charging sits idle waiting for a new command. |

**Rules:**
- A faction can hold at most one mid-research at a time. Subsequent `StartResearchAtPod` commands are silently rejected.
- Auto-resume only re-picks the last harvest target. Build tasks are one-shot — there's nothing to resume.
- If the previous harvest node has been depleted (or otherwise died), the worker drops to idle instead.
- The renderer surfaces the research as a button on the selected pod (`RESEARCH AUTO-RESUME` with cost + hotkey `R`), an in-progress label (`RESEARCHING (Xs)`), or a status label (`AUTO-RESUME ACTIVE`) once complete.

---

## Victory conditions

- **HQ destruction** — destroy the enemy HQ. The other faction wins. (No combat units are currently in the active sim, so this path is unreachable through gameplay — it remains the canonical win condition that combat units will route to once Phase D reintroduces them.)
- **Resign** — `CommandKind.Resign` (slot 13). The named faction concedes; the other faction wins. No-op if a winner is already set.

---

## Controls

### Mouse

- **Left-click** an owned unit → selects only that unit (replaces any prior selection).
- **Shift + left-click** an owned unit → toggle that unit in or out of the current selection.
- **Left-click + drag** on empty ground → drag-rectangle. On release, every owned unit inside the rect joins the selection (shift-drag adds).
- With selected workers, **left-click** a node → all selected workers are assigned to harvest there. Each accepted worker pays 1 charge; workers in charge mode silently flash the lightning cue.
- **Right-click** on empty ground → MoveUnit for every selected unit. Workers in charge mode flash the lightning cue and stay put.
- **Left-click on empty ground** → clears the unit selection.
- **Left-click your HQ** → selects the HQ (TRAIN WORKER appears on the action bar with a `used/cap` indicator).
- **Left-click a work pod** → selects the pod (info-only panel for now).
- **Esc** → clears selection. Cancels any pending placement.

### Keyboard

- **R** — download the current replay as JSON.
- **W / A / S / D** or **arrow keys** — pan the camera (continuous while held).

### Camera

- **Middle-mouse drag** — pan the camera.
- **Scroll wheel** — zoom in / out within 0.5×–2.0× of the default frustum height.

### Action bar (bottom of screen)

- Select your **HQ** → **TRAIN WORKER** + a `used/cap` indicator. Greys out when at the cap or out of Energy.
- Select a **Worker** (one or more) → **BUILD WORK POD**. Greys out if no selected worker is actionable (in charge mode / 0 charge) or if Energy can't cover the cost.
- Select a **Work Pod** → **RESEARCH AUTO-RESUME** (or its in-progress / completed status) + a `+5 cap · charge bay` info hint.
- Anything else / nothing → guidance hint.

---

## AI behaviour

The AI ticks once every 10 sim ticks (0.5 s at 20 Hz) and does, in order:

1. **Auto-assign idle workers** to the nearest discovered, live energy node. Skips workers in charge mode or at 0 charge.
2. **Train workers** up to the current supply cap as long as Energy covers the cost.
3. **Build a work pod** when at the supply cap AND no pod is mid-construction AND Energy covers the build cost AND it has an actionable worker AND it owns fewer than 5 pods. Tile is picked deterministically from a fixed offset table around the HQ.

The AI does not yet research auto-resume on its own. That's a player decision for now; the AI's autonomous tech progression lands in a follow-up sub-phase.

---

## Current map

Single hardcoded map, defined in `src/main.ts`.

- **Grid:** 32×32 tiles.
- **HQ positions:** faction 0 at (4, 4), faction 1 at (27, 27) — opposite corners.
- **Energy nodes:** six. Two near each HQ ((7, 4), (4, 7), (24, 27), (27, 24)) and two mid-distance "second base" nodes on the diagonals ((11, 20), (20, 11)). Each starts with 200 energy.
- **Starting pools:** 200 Energy per faction. Workers spawn at full charge (10/10).
- **Vision:** fog of war active. Each faction's home patch is auto-discovered at tick 0; the contested midfield + the opponent's home patch require scouting to see.
- **Terrain:** flat, no vision blockers, no impassable tiles.
