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

**Renderer cues (Phase C.4 — motion & world life):**
- **Charge ring** — a gold radial arc at a charging worker's base that fills with the charge fraction. Replaces the old tiny charge bar as the at-a-glance read; the precise value still shows in the selection portrait.
- **Work-state beams** — a glowing floor conduit from a working worker to its target: green to the node it's harvesting, gold to the pod/HQ it's charging at, faction-tinted to the structure it's building.
- **Idle hover** — a standing worker bobs gently so it reads as alive; a moving worker's body energises (inner glow) so transit looks different from rest.
- **Building life** — the HQ pulses (bright accent cap dims + brightens, body tiers breathe) and operational work-pod caps pulse, so the base reads alive even before any worker is trained.
- **Node life** — energy nodes slowly spin their core and breathe their emissive, so a resource reads as a live source at rest.
- **Research-complete ripple** — a gold pulse on every owned worker + operational pod the instant an upgrade lands (pairs with the research-complete chime).
- **Floating lightning icon** on a worker when the player tries to command it during charge mode. ~1 s fade.

### Vision + scouting

The renderer filters per faction. Friendly units, the friendly HQ, and friendly work pods are always visible; enemy entities are hidden until they enter the player's current vision bubble (no last-known-position memory in v1). Vision radii (in tiles): worker 4, HQ 8, work pod 5.

Resource nodes are discovered persistently — once a friendly unit / HQ / pod comes within vision of a node, the faction's `discoveredBy[node]` flag flips to true and stays true forever (no fog-of-war rediscovery). Each faction's home patch is auto-discovered at tick 0. Right-click-moving a worker is the canonical scouting action. Observer mode bypasses vision entirely (sees both factions' state).

---

## Units

| Kind | HP | Speed | Train cost | Max charge | Train time | Trained at |
|---|---|---|---|---|---|---|
| **Worker (Swarm)** | 30 | 0.055 | 40 E | 10 | 40 ticks (2 s) | HQ |
| **Worker (Siege)** | 60 | 0.045 | 60 E | 10 | 40 ticks (2 s) | HQ |

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
- `TrainUnit` is silently rejected when the cap is full. Phase C.2: queued-but-not-yet-spawned workers count against the cap too — the gate is `supplyUsed + queued >= supplyCap`, so you can't over-queue past the cap. `supplyUsed` / `supplyCap` are recomputed at end of each sim step.

### Production queue (Phase C.2)

- Worker training is **timed**, not instant: each worker takes **40 ticks (2 s)** to produce.
- Each HQ holds a **FIFO production queue** (max **5** entries). `TrainUnit` pays the worker's Energy cost **and reserves a supply slot at enqueue**; the head of the queue counts down (`trainTicksRemaining`) and the worker spawns on completion — at the HQ perimeter via the round-robin offset table, or at an explicit tile when the command carries one.
- The queue is bounded by both `MAX_TRAIN_QUEUE` (5) and the supply cap — whichever is smaller.

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
- **Left-click your HQ** → selects the HQ (the command card shows the TRAIN WORKER tile + a `used/cap` indicator; a production-queue strip appears above it while workers are training).
- **Left-click a work pod** → selects the pod (info-only panel for now).
- **Esc** → clears selection. Cancels any pending placement.

### Keyboard

- **R** — download the current replay as JSON.
- **M** — toggle mute (silences every cue **and** the ambient bed; status shown top-right).
- **W / A / S / D** or **arrow keys** — pan the camera (continuous while held).

### Camera

- **Middle-mouse drag** — pan the camera.
- **Scroll wheel** — zoom in / out within 0.5×–2.0× of the default frustum height.

### Command HUD (Phase C.2 — SC2 command-card model)

A fixed-footprint HUD; nothing resizes to fit its text.

- **Resource bar (top-centre):** HQ HP · Energy · **Matter** (reserved + greyed until Phase C.7) · Supply `used/cap` (pulses red/white at the cap — build a work pod to raise it).
- **Portrait panel (bottom-left):** a 3D snapshot of the selected entity + its name, plus an action-state icon and HP / charge bars (workers), HP + build status (pods), or remaining energy (nodes).
- **Command card (bottom-centre):** a fixed 3-wide grid of **icon tiles**, each with a hotkey badge (top-left) + Energy-cost badge (top-right); unused slots render as dim cells. Above it, a **production-queue strip** shows the queued workers, the head one carrying a production-progress bar.
- **Minimap (bottom-right):** a top-down map of the arena. Blips mirror what's currently visible in the 3D scene (so it respects fog), plus a camera-focus marker. **Click anywhere on it to recentre the camera.**

Tiles by selection:
- **HQ** → **TRAIN WORKER** (`W`). Greys out at the cap (queued units count toward it), when the queue is full (5), or out of Energy.
- **Worker** (one or more) → **BUILD WORK POD** (`B`). Greys out if no selected worker is actionable (charge mode / 0 charge) or Energy can't cover the cost.
- **Work Pod** → **AUTO-RESUME** research (`R`) — or its in-progress (`RESEARCHING Xs`) / completed state — with a `+5 cap · charge bay` hint.
- Anything else / nothing → an empty card + guidance hint.

A dense diagnostic panel (tick / winner / both factions' stats / dropped steps / peer state) is available via `?debug=1`.

### Audio (Phase C.3)

Fully synthesised via the Web Audio API — **no sampled assets, no loader**. Web Audio needs a user gesture to start, so sound unlocks on the first menu interaction (or the first in-match click); anything fired before that is silently dropped. **M** mutes everything.

**Ambient bed** — a low, slowly-pulsing Tron drone starts on match begin and runs for the match. It's faction-tinted (cyan plays a whole tone above red, so the bed alone tells you your side), sits well under the cues in the mix, and dips briefly each time a cue fires so the cue cuts through.

**Cues** — each meaningful action fires a distinct synth cue:

| Cue | Fires when |
|---|---|
| **select** | You select an entity (unit / HQ / work pod / node) — soft rising ping. |
| **move** | You issue a move order — quick downward swish. |
| **harvest** | You assign workers to a node — upward chirp (the opposite gesture to *move*). |
| **charge start** | A worker drops into charge mode — low descending sweep. |
| **charge complete** | A worker leaves charge mode at a full tank — bright rising sweep. |
| **research start** | Research begins at a pod — mid two-step. |
| **research complete** | An upgrade lands — rising three-note "unlock" chime. |
| **train complete** | A worker spawns at the HQ — rising two-note chime. |
| **build complete** | A work pod becomes operational — double tick. |
| **HQ alert** | The friendly HQ takes damage — pulsing low triple-beep. |

Charge / research / build / train / HQ-alert cues are detected renderer-side by diffing sim state between ticks (`event-detector.ts`) — **the sim never references audio**, so cues can't affect the determinism gate. Select / move / harvest fire from the input controller alongside the on-screen feedback pings. (A UI **click** also plays on every command-card button press, and the main menu plays a **faction-switch** cue.)

---

## Tutorial

A guided sandbox for first-time players. Launch it from the **main menu** via the **TUTORIAL** entry (or press **T**); the selected faction carries in. `?tutorial=1` deep-links straight into it (skips the menu).

The sandbox is a calm, deterministic scenario — generous starting energy (400), energy nodes by both home corners, and **no enemy AI** (the opponent HQ sits passively in the far corner). Nothing here touches the deterministic sim's hash; the tutorial is a renderer-side layer that reads state and never writes it.

**Guided phase.** A coach bubble with a looping ghost-cursor demonstrates each gesture and only advances once you perform it: (1) select your HQ, (2) train workers until you hit the supply cap (5/5), (3) build a work pod to raise the cap, (4) harvest energy, (5) camera controls — zoom / pan / minimap (acknowledge), (6) scout a worker toward the enemy corner, (7) read the charge meter (acknowledge), (8) select the work pod, (9) research auto-resume. Training to the cap comes before building so the build step always has a freshly-charged worker to dispatch, and so the capacity wall (the cap stops you at 5/5) motivates the pod.

**Graduation phase.** An objectives panel (top-left) then tracks three completion goals:

| Goal | Target | Teaches |
|---|---|---|
| **Energy** | energy balance ≥ **300** | sustained harvesting |
| **Workers** | **15** alive workers | training + capacity (cap starts at 5, +5 per operational pod → needs ~2 pods) |
| **Find the enemy HQ** | enemy HQ tile uncovered | scouting (move a worker across the map) |

Meeting all three shows **TUTORIAL COMPLETE** and returns you to the menu. **SKIP TUTORIAL** (top-right) exits at any time. Goal targets are tunable (`GOAL_THRESHOLDS` in `src/render/tutorial/tutorial-steps.ts`).

A normal match shows a one-line **first-action nudge** ("select your HQ") on entry, which clears once you select the HQ or after ~12 s. Committing from the menu (match or tutorial) plays a short wash/fade transition instead of an instant cut.

---

## AI behaviour

The AI ticks once every 10 sim ticks (0.5 s at 20 Hz) and does, in order:

1. **Auto-assign idle workers** to the nearest discovered, live energy node. Skips workers in charge mode or at 0 charge.
2. **Train workers** up to the current supply cap as long as Energy covers the cost.
3. **Build a work pod** when at the supply cap AND no pod is mid-construction AND Energy covers the build cost AND it has an actionable worker AND it owns fewer than 5 pods. Tile is picked deterministically from a fixed offset table around the HQ.

The AI does not yet research auto-resume on its own. That's a player decision for now; the AI's autonomous tech progression lands in a follow-up sub-phase.

---

## Current map

Single hardcoded match map, defined in `src/main.ts` (the **Tutorial** uses its own generous sandbox spec, `TUTORIAL_SPEC`, in the same file).

- **Grid:** 32×32 tiles.
- **HQ positions:** faction 0 at (4, 4), faction 1 at (27, 27) — opposite corners.
- **Energy nodes:** six. Two near each HQ ((7, 4), (4, 7), (24, 27), (27, 24)) and two mid-distance "second base" nodes on the diagonals ((11, 20), (20, 11)). Each starts with 200 energy.
- **Starting pools:** 200 Energy per faction. Workers spawn at full charge (10/10).
- **Vision:** fog of war active. Each faction's home patch is auto-discovered at tick 0; the contested midfield + the opponent's home patch require scouting to see.
- **Terrain:** flat, no vision blockers, no impassable tiles.
