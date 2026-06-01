# Vylux Manual

> **Audience:** anyone — players, internal alpha testers, agents, future-Jaco — who needs to know **what is currently in the game**, not the design vision behind it. The vision lives in [`plan.md`](plan.md); the in-progress design intent and phase plan live there too.

> **Currency:** this file MUST be updated as part of any change that adds, removes, or re-tunes a unit, structure, resource, tech, or victory condition. If the numbers in this file disagree with `src/sim/units-config.ts`, **the config wins** — patch this doc.

> **Phase C.1 (2026-05-12) landed:** work pods + worker per-unit charge + the first research item (auto-resume). Workers now spend 1 charge per task (harvest cycle or build). At 0 charge a worker enters charge mode (walks to the nearest charge spot — the closest friendly work pod or its HQ, whichever is actually nearer) and refuses player commands until fully recharged. Each operational work pod also raises the worker cap, and hosts the worker auto-resume research. AI actively grows its workforce — it trains workers up to the cap and builds work pods to raise the cap further.

> **Phase D.1 (2026-05-29) landed — Matter + cost split.** A second resource, **Matter** (construction material), joins Energy. ~⅓ of map nodes are now matter nodes (amber, squat block silhouette vs energy's gold spike); workers harvest + deposit them exactly like energy, crediting a separate `faction.matter` pool. Costs are now `{ energy?, matter? }`: the **work pod costs 40 E + 30 M** (was 60 E); workers stay energy-only. The carried-forward open question is resolved — **harvested resources are build/train-time spend only, no upkeep** (the per-worker *charge* battery remains the only ongoing drain, and is a separate concept from harvested Energy — the docs/code standardise on "charge" for it to stop the two senses of "energy" colliding). Matter **feeds the score** alongside energy — the score spine is now total resources harvested (cumulative `energyHarvested` + `matterHarvested`). The resource bar's reserved Matter slot goes live. The AI keeps one worker steadily on matter so it can afford pods. The scored-match length is also raised to **15 minutes**. Determinism: `REPLAY_VERSION` bumped to 34, goldens regenerated.

> **Pre-Phase-D ad-hoc: scored match (2026-05-28) landed.** A normal PvA match now ends — instead of running forever until the field depletes with no defined outcome. The match has a **15-minute timer** (configurable as `matchLengthTicks` per spec) and an early-end when the **whole node field is mined out**. At either end the **higher score wins** with a deterministic tie-break. The score is `cumulative resources harvested (energy + matter) + alive workers × 10 + operational pods × 30` — see `src/sim/score.ts` (single source of truth: the HUD scoreboard, the live ranked panel, and the buzzer all read the same formula). A new **scoreboard + countdown panel** appears top-left during scored matches; the end overlay now carries the final ranked breakdown plus a **MENU** button back to the main menu (alongside NEW RUN / DOWNLOAD REPLAY). The energy field is also now **mirrored** — generated in one half and rotated 180° about the board centre — so neither side starts with a free-win seed. Tutorial + tests + the determinism-gate scripted matches leave `matchLengthTicks` unset, so they behave exactly as before.

---

## Resources

| Resource | Source | Used for | Notes |
|---|---|---|---|
| **Energy** | Energy nodes scattered around the map. Workers gather → return → deposit at HQ. | Worker training, work pod construction; **part of the match score spine** (cumulative energy + matter harvested). | The power that runs things. **Build/train-time spend only — no ongoing upkeep.** Distinct from a worker's per-task *charge* battery (see below) — two different things, despite the shared word. |
| **Matter** | Matter nodes (amber, distinct squat silhouette) scattered around the map — ~⅓ of nodes. Harvested → deposited at HQ exactly like energy. | Construction material — work pod construction (alongside energy). | Build-time spend; **also scored** — cumulative matter harvested counts toward the score alongside energy. Lands live in Phase D.1. The guaranteed near-HQ node is always energy, so matter is something you scout out and expand toward. |

> **Cost shape (Phase D.1).** Costs are `{ energy?, matter? }` — an item may cost energy only, matter only, or both. At this cut: a **worker** costs energy only (units run on power); a **work pod** costs **both** (40 E + 30 M — construction needs material and power). The cost system supports any split; these are the D.1 values (placeholders, retuned in playtest).

### Worker harvest model

Workers walk to a node, harvest for one *harvest interval* (23 ticks ≈ 1.15 s — identical across factions since C.6.5; see faction note below), pick up `HARVEST_AMOUNT` clamped by `WORKER_CAPACITY`, walk back to HQ, deposit, and resume. Workers don't trickle. Newly-trained workers stand idle on spawn and after each deposit until the player issues a command — auto-assign is removed from the player path so the player keeps agency over where workers go (the AI still auto-assigns its own faction).

### Worker charge (Phase C.1)

Every worker carries an internal `charge` meter (default max **10**, drains **1** per task at task-start). Movement is **free while charge > 0**; once charge hits 0, the worker enters **charge mode** and refuses every player command (move, harvest, build) until it has fully recharged.

**What counts as a task** (1 charge each, charged at start):
- One harvest cycle — `movingToNode → harvesting → returning → deposit at HQ`. One full cycle = 1 charge.
- One build action — `movingToBuildSite → building → operational`. 1 charge.
- Aborted tasks (player redirects mid-cycle, node depletes, build cancelled): **still cost a full charge**. Drain is at start, no refund.
- `MoveUnit` is free while charge > 0 (the worker has fuel to spare).

**Charge-spot picking:**
- Head to the **physically nearest** charge spot — the closest friendly operational work pod **or** the friendly HQ, whichever the worker is actually nearer to. A worker no longer treks across the map to a distant pod when its own HQ is right next door.
- If there is no operational pod, the HQ is the only spot.
- On a tie (equal distance) the pod wins, since it recharges twice as fast.

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

Resource nodes are discovered persistently — once a friendly unit / HQ / pod comes within vision of a node, the faction's `discoveredBy[node]` flag flips to true and stays true forever (no fog-of-war rediscovery). **Tile exploration** is tracked the same way and (since C.6.7) lives in the deterministic sim as a per-faction explored bitmap (`SimState.explored`): both factions have their own, seeded from each HQ's opening vision and extended every tick by friendly vision. The human fog overlay reads this set directly — one source of truth, the same set the AI scouts against. Each faction's home patch is auto-discovered at tick 0.

**Scouting (C.6.8–C.6.10).** Select a worker and press the **SCOUT** command-card button (hotkey **E**) to send it exploring. Scouting is **free** — it spends no charge (it's exploration, not an energy-burning task), so a worker can scout on as little as 1 charge and keeps it, staying fully controllable. It still requires a controllable worker: one that needs a charge (0 charge / in charge mode) can't be sent scouting. The scout auto-routes to the nearest *unexplored* frontier tile, revealing fog (and any nodes) en route, re-targeting until the faction's map is fully uncovered — then it drops back to idle. The button greys out once everything is revealed. Target selection never reads undiscovered node positions (no peeking under the fog). Right-click-moving a worker is still a manual scouting option. The AI uses the same scout order (see AI behaviour). Observer mode bypasses vision entirely (sees both factions' state).

---

## Units

| Kind | HP | Speed | Train cost | Harvest interval | Max charge | Train time | Trained at |
|---|---|---|---|---|---|---|---|
| **Worker (Swarm)** | 30 | 0.055 | 40 E | 23 ticks | 10 | 40 ticks (2 s) | HQ |
| **Worker (Siege)** | 30 | 0.055 | 40 E | 23 ticks | 10 | 40 ticks (2 s) | HQ |

`E` = Energy. Speeds are tiles per sim tick (sim runs at 20 Hz; multiply by 20 for tiles/second).

**Faction asymmetry — parked (C.6.5, 2026-05-24):** the C.1 first-cut worker
asymmetry (Siege slower + costlier + tougher, faster harvest) made Siege
strictly worse to play, so **Siege's worker stats are flattened to Swarm's** —
the two are mechanically identical for now (the faction picker still differs by
colour). Real asymmetry returns when combat units land (Phase D); the
per-faction override blocks in `units-config.ts` stay as the divergence hooks.

### Behaviour

- **Worker** — gathers from any live node (energy or matter), builds work pods, runs on its own internal charge meter. Cannot fight. Carrying is lost on death.
- **Pathfinding (Phase C.6.6)** — workers route around static blockers (both HQs, operational work pods, live energy nodes) using grid **A\***: a waypoint path computed when the destination is set, cached, and walked in a straight line leg-to-leg. Each work pod and node occupies **exactly one tile**, so pods on adjacent tiles form a wall the worker routes around, while pods left a tile apart leave a genuine, passable gap. A worker heading *to* a blocker (its node, build site, charge spot, HQ) goes straight in. Movement is deliberately **blocky** (no smoothing layer — an earlier smoothed/steering version was reverted for performance + getting stuck); if a target is fully walled off the worker falls back to a straight line (may clip) rather than freezing.

---

## Structures

| Structure | HP | Cost | Build time | Role |
|---|---|---|---|---|
| **HQ** | 250 (configurable per match) | — | — (placed at match start) | Trains workers. Losing it ends the match. Acts as a charge spot at half the pod rate — used whenever it's the nearest spot to a depleted worker, or the only one. Provides 5 worker cap. |
| **Work Pod** | 100 | 40 E + 30 M | 30 ticks (1.5 s) | Built by a worker. Occupies a single tile (no overlap with neighbours). While operational: +5 worker cap, and acts as a primary charge spot (faster than HQ). Hosts (future) worker-upgrade research — slot reserved, no upgrades yet. |

### Build flow (Work Pod)

1. Select one or more workers.
2. Click **BUILD WORK POD** on the action bar (hotkey **B**) — the cursor switches to crosshair, and a tile preview follows the cursor: **green** where a pod may be built, **red** where it's blocked.
3. Left-click a **valid** tile to commit the placement. The lowest-ID actionable worker is dispatched: it pays 1 charge, the faction pays the pod cost (40 Energy + 30 Matter), the pod spawns with full `buildTicksRemaining`. Pods may **not** be built within 1 tile of an energy node (Phase C.6.6 — keeps the node's harvest approach clear for pathing); clicking a red tile is ignored and placement mode stays active. Right-click / Esc cancels.
4. The worker walks to the site (`movingToBuildSite`), arrives (`building`), and ticks the structure down (1 tick per sim tick while on site). At 0 ticks the pod becomes operational.
5. Build aborted (worker redirected, worker killed): the pod stays under construction, frozen at its current progress. **To finish it, select one or more workers and left-click the half-built pod** (the same left-click-the-target gesture used to assign harvesting) — each pays 1 charge and walks over to complete the build (no Energy is re-paid; the build cost was already spent at placement). Multiple workers stack on site and finish it faster.

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

Three paths to a winner, in **runtime priority order** (highest first — the sim freezes the moment a winner is set, so an earlier path pre-empts a later one within the same tick; see `win.test.ts`):

1. **Resign** — `CommandKind.Resign` (slot 13). The named faction concedes; the other faction wins. Applied during command processing (`step.ts:472`), which runs **before** the per-tick winner checks, so a Resign in the same tick as a fatal HQ blow still routes the win to whoever the resigner conceded to. No-op if a winner is already set.
2. **HQ destruction** — destroy the enemy HQ. The other faction wins. Combat units aren't in the active sim yet (they return in Phase E), so this path is unreachable through gameplay today; it stays the canonical win condition combat units will route to.
3. **Score victory** — only in **scored mode** (the spec carries `matchLengthTicks > 0`; the live PvA / lockstep / observe spec opts in, the tutorial + tests do not). Triggers when either (a) the timer expires (`tick + 1 >= matchLengthTicks`) or (b) the entire energy field is depleted **and** no worker is still carrying a final load (carrying workers get to deposit before the buzzer rules). The higher score wins; the deterministic tie-break cascades through total → raw cumulative harvest → HQ HP → faction 0. Live arena defaults: **5-minute timer** (6000 ticks at 20 Hz) on a 64² mirrored field.

### Score

The match score is computed by `scoreBreakdown(state, faction)` in `src/sim/score.ts` — the same function the buzzer reads and the HUD shows, so the on-screen number is exactly what the winner decision ranks on. Integer + deterministic (no floats).

| Component | Weight |
|---|---|
| Cumulative energy harvested (`faction.energyHarvested`, floored) | × 1 |
| Alive workers | × 10 |
| Operational work pods (`buildTicksRemaining === 0`) | × 30 |

Cumulative harvest is the spine — the honest "how much have you collected." Workers/pods add small bonuses so a pure hoarder doesn't outscore a developed economy. Weights live in `score.ts` (`SCORE_WORKER_BONUS`, `SCORE_STRUCTURE_BONUS`) and are tunable in playtest; bumping either invalidates timed-match goldens.

`faction.energyHarvested` is a **monotonic** Fixed counter — incremented at the single deposit site in `step.ts`, never decremented. The spendable `faction.energy` balance drops when you train / build; the score-spine total doesn't.

### Live HUD

- **Top-right panel** (scored matches only): a big mm:ss countdown above two ranked rows — YOU vs AI, faction-colour-tinted, with a ▲ marker on the current leader. Hidden in the tutorial + any spec without `matchLengthTicks`.
- **End overlay** — fires the moment a winner is set; shows VICTORY / DEFEATED, the faction tagline, and a final ranked scoreboard (harvest · workers · pods · total per faction). Buttons: **NEW RUN** (reload), **MENU** (returns to main menu — strips URL query so a `?tutorial=1` deep-link doesn't re-trigger the tutorial), **DOWNLOAD REPLAY**.

---

## Controls

### Mouse

- **Left-click** an owned unit → selects only that unit (replaces any prior selection).
- **Shift + left-click** an owned unit → toggle that unit in or out of the current selection.
- **Left-click + drag** on empty ground → drag-rectangle. On release, every owned **unit** inside the rect joins the selection (shift-drag adds). The drag-rect only ever picks units — buildings (HQ / work pods) are **never** drag-selectable, and a drag that grabs workers drops any HQ / pod that was focused from an earlier click, so the HUD follows the workers, not a stale building.
- With selected workers, **left-click** a node → all selected workers are assigned to harvest there. Each accepted worker pays 1 charge; workers in charge mode silently flash the lightning cue.
- With selected workers, **left-click** a friendly **half-built work pod** → the workers walk over and finish constructing it (each pays 1 charge; no Energy re-paid). Mirrors the left-click-a-node-to-harvest order; right-click stays move-only. See *Build flow* above.
- **Right-click** on empty ground → MoveUnit for every selected unit. Workers in charge mode flash the lightning cue and stay put.
- **Left-click on empty ground** → clears the unit selection.
- **Left-click your HQ** → selects the HQ (the command card shows the TRAIN WORKER tile + a `used/cap` indicator; a production-queue strip appears above it while workers are training). Buildings are selected by **left-click only**, never by drag.
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
- **Scoreboard panel (top-left, scored matches only):** match countdown (mm:ss) above a two-row ranked scoreboard — YOU vs AI, faction-tinted, with a ▲ marker on the current leader. The number is the same `scoreBreakdown` the timed-end winner reads, so what you see is what wins. Hidden in the tutorial + any spec without `matchLengthTicks`.
- **Portrait panel (bottom-left):** a live 3D render of the selected entity + its name, plus an action-state icon and HP / charge bars (workers), HP + build status (pods), or remaining energy (nodes). The portrait isn't static — the entity plays its in-game life animation (HQ / pod emissive breathe, worker idle hover, node spin) and slowly turntable-rotates at a fixed rate so you see it from every side.
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

**Guided phase.** A coach bubble with a looping ghost-cursor demonstrates each gesture and only advances once you perform it: (1) select your HQ, (2) train workers until you hit the supply cap (5/5), (3) select a worker, (4) build a work pod to raise the cap, (5) harvest energy, (6) camera controls — zoom / pan / minimap (acknowledge), (7) scout a worker toward the enemy corner, (8) read the charge meter (acknowledge), (9) select the work pod, (10) research auto-resume. Training to the cap comes before building so the build step always has a freshly-charged worker to dispatch, and so the capacity wall (the cap stops you at 5/5) motivates the pod. Selecting a worker is its own step (the ghost points at an actual worker) so the build instruction isn't ambiguous once five workers are on the field.

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

1. **Keep one matter harvester** (Phase D.1). If the faction has discovered a live matter node and no worker is already committed to matter, it claims the idle worker nearest that node and assigns it — so the AI reliably collects matter to afford pods. Runs first and reserves its worker so the next two steps don't fight over it.
2. **Auto-assign idle workers** to the nearest discovered, live node (any kind). Skips workers in charge mode or at 0 charge.
3. **Scout when starved** (C.6.10). A worker that's sat idle ≈2 s (40 ticks) with no discovered live node left to harvest is dispatched to scout. The AI scales the number of scouts with how many workers are stalled — about half of them, capped at 3 — so it uncovers new ground quickly without pulling its whole workforce off harvesting; the scouts reveal fog → fresh nodes → step 1 feeds the remaining workers onto them. The AI never scouts a fully-revealed map. This is what stops the AI stalling on the big randomised map once its home patch runs dry (it used to freeze with no discovered node left).
4. **Train workers** up to the current supply cap as long as Energy covers the cost.
5. **Build a work pod** when at the supply cap AND no pod is mid-construction AND it can afford the build cost (now **energy + matter**) AND it has an actionable worker (one not just sent scouting or harvesting matter) AND it owns fewer than 5 pods. Tile is picked deterministically from a fixed offset table around the HQ.

The AI does not yet research auto-resume on its own, nor does it yet *prefer* a distant discovered node over scouting / bias pod placement toward node clusters — those refinements (expand-harvest, cluster-aware pods) land in C.6.11–C.6.12. Autonomous tech progression is later still.

---

## Current map

The arena is defined in `src/main.ts`; the energy field is generated by `src/sim/map-gen.ts` (the **Tutorial** uses its own hand-placed sandbox spec, `TUTORIAL_SPEC`, in the same file).

- **Grid:** 64×64 tiles (doubled from 32 in Phase C.6.5).
- **HQ positions:** faction 0 (player) at (8, 55) — bottom-left; faction 1 (AI) at (55, 8) — top-right. Opposite corners on the anti-diagonal.
- **Energy nodes:** a **seeded, mirrored field** — 16 nodes (8 source + 8 mirrored), fresh each PvA match (the seed is baked into the spec, so replays reproduce the layout). The generator draws each node in the source half (`x + y < 63`) and pairs it with its **180° rotation about the board centre** (`(x,y) → (63−x, 63−y)`), so the two halves are identical up to the rotation that swaps the HQs — neither side gets a free-win seed. Same constraints as before: never on an HQ tile, never directly adjacent (the 8 neighbours) to an HQ, never on the outer edge ring, no two nodes closer than 3 tiles, **≥1 node guaranteed within each HQ's vision** so neither side starts blind (the mirror covers both HQs from one source-side guarantee — `R` is an isometry that swaps the HQs). Each node is randomly assigned a **low / med / high** value (≈120 / 220 / 360 energy, weighted toward low+med) and its **mirror twin carries the same energy**; the tier shows visually — richer nodes glow **brighter** (more emissive + bloom) with a slight hue lift toward white on the high tier. (Lockstep modes keep a fixed-seed field so both peers agree; the tutorial keeps its hand-placed nodes — no mirror.) Mirror generation requires an even `count` and HQs point-symmetric about the centre; the generator throws otherwise. **Phase D.1:** each source/mirror pair is also assigned a **kind** — ~1 in 3 pairs is **matter** (both twins share the kind, so matter access is symmetric), the rest energy; the guaranteed near-HQ pair is always energy. Phase D.2 may replace this exact mirror with "varied but balanced" clusters (different positions, equal value-budget per side); for the prototype, exact mirror is the cheapest trustworthy fairness floor.
- **Starting pools:** 200 Energy per faction. Workers spawn at full charge (10/10).
- **Vision:** fog of war active. Each faction's home patch is auto-discovered at tick 0; the rest of the (now larger) map requires scouting to see.
- **Terrain:** flat, no vision blockers, no impassable tiles.
