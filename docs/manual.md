# Vylux Manual

> **Audience:** anyone — players, internal alpha testers, agents, future-Jaco — who needs to know **what is currently in the game**, not the design vision behind it. This is the catalog. The vision lives in [`product/PRD.md`](product/PRD.md); the engineering history lives in [`investigation/`](investigation/).

> **Currency:** this file MUST be updated as part of any sub-phase that adds, removes, or re-tunes a unit, structure, resource, tech, or victory condition. The investigation-doc closing checklist enforces this, and the contract is mirrored in `AGENTS.md`. If the numbers in this file disagree with `src/sim/units-config.ts`, **the config wins** — patch this doc.

> **Last sub-phase that touched these numbers:** 3.8 (fog of war + node discovery).

> **2026-05-07 pivot context.** Vylux moved from competitive 1v1 / esport to **single-player PvE** (wave-defense + roguelike-run shape). The catalog below — units, structures, resources, tech, controls, current map — carries forward unchanged into the PvE direction; the pivot is a *design* shift, not a code rewrite. Numbers and behaviours documented here are **what's currently in the game**, not what the PvE direction will eventually call for. Sub-phases 3.11–3.14 will repoint the catalog (enemy AI faction kinds, wave-scheduler, PvE win conditions). Until then, the build still presents as the original skirmish loop. See PRD §0 for the pivot notice and `docs/investigation/04-phase-3-faction-and-map-depth.md` for what's coming.

---

## Resources

Three resources, in the shape PRD §6.3 commits to.

| Resource | Source | Used for | Notes |
|---|---|---|---|
| **Energy** | Energy nodes (most map nodes). Workers gather → return → deposit at HQ. | Workers, all structures, tier-1 + tier-2 combat units. | Plentiful, decentralised. Most nodes are Energy. |
| **Flux** | Flux nodes (small set, contested). Same gather-and-deposit loop; deposits to a separate pool. | Tier-2 research at the Spire, tier-2 unit production at the Forge. | Phase 3.1 added Flux as a distinct resource. The launch SPEC currently has 1 Flux node at the map centre. |
| **Colour** (Blue / Red) | Colour nodes — **faction-locked**: blue nodes only by faction 0 (cyan), red only by faction 1 (red-orange). | Every unit and every structure (small cost). Lockout-by-denial: pushed off your colour nodes → no production until you reclaim. | Phase 3.5. Colour nodes regenerate passively (~1 / sec) toward a 100-unit cap, so a denied faction recovers slowly. Energy + Flux nodes don't regen and still die at empty. |

**Worker model:** workers walk to a node, harvest for `HARVEST_TICKS` (~1 second), pick up `HARVEST_AMOUNT` clamped by `WORKER_CAPACITY`, walk back to HQ, deposit, and resume. Workers don't stand on a node and trickle. A worker assigned (manually or by auto-assign) to a foreign-colour node is silently dropped back to idle. **Phase 3.9.2:** newly-trained player-faction workers stand idle on spawn and after each deposit until the player issues a command — auto-assign was removed from the player path so the player keeps agency over where workers go (the AI still auto-assigns its own faction). PRD §6.3.

### Supply (Phase 3.6)

Every alive unit consumes a `supplyCost` from its faction's `supplyCap`. The cap starts at 10 and grows by 8 per operational Pylon. Train commands (`TrainUnit` at HQ, `TrainAtStructure` at a Forge) silently reject when the unit's supply would push past the cap. `TrainAtStructure` reserves the supply at queue time, so a second train command can't double-book the slot mid-train. Killing a Pylon recomputes the cap (faction loses 8); existing units are never auto-killed for supply reasons, but new training is blocked until the cap recovers.

### Energy dump + light trails (Phase 3.7)

Workers can activate an **energy dump** — for 40 ticks (2 s) the worker moves at 2× speed and bleeds a deadly light-trail segment per tick. Costs 100 Energy upfront and triggers a 200-tick (10 s) cooldown after the dump ends. Any non-owner unit that overlaps a trail segment dies instantly (within ~0.4 tile). Same-faction units and structures are immune; the dumping worker walks through their own trail unharmed.

Trail segments fade visually with age (opacity + emissive intensity) and expire after `TRAIL_SEGMENT_LIFETIME = 60` ticks (3 s). Researching **TRAIL+** at a Spire (40 Flux, 80 ticks) doubles the lifetime to 6 s for the faction's existing and future trails — the segment-age check looks up the flag at expiry-time, so an in-flight trail extends the moment the research completes.

### Vision + scouting (Phase 3.8)

The renderer filters per faction. Friendly units, structures, and HQ are always visible; **enemy units, enemy structures, and the enemy HQ are hidden until they enter the player's current vision bubble** (no last-known-position memory in v1). Vision radii (in tiles): worker 4, defender 5, raider 5, vanguard 6, HQ 8, Forge / Spire 6, Pylon 5.

**Resource nodes are discovered persistently** — once a friendly unit / structure walks within vision of a node, the faction's `discoveredBy[node]` flag flips to true and stays true forever (no fog-of-war rediscovery). The node draws to the renderer afterward even outside current vision, and the player can right-click workers onto it. Nodes outside any friendly vision at match start are hidden until scouted; the AI's auto-route + worker-bias helpers also only consider discovered nodes. Each faction's home patch (within HQ vision) is auto-discovered at tick 0 so the player + AI can both bootstrap.

There's no separate scout-mode command; right-click-moving a worker (or marching combat units) is enough to scout. Observer mode bypasses vision entirely (sees both factions' state). The sim itself stays canonical-and-full-state — vision is a presentation concern; lockstep determinism + replay round-trip are unaffected.

---

## Units

| Kind | Tier | HP | Speed | Range | Damage | Cooldown | Cost | Supply | Train time | Trained at |
|---|---|---|---|---|---|---|---|---|---|---|
| **Worker** | T1 (eco) | 40 | 0.05 | — | 0 | — | 50 E + 5 C | 1 | instant | HQ |
| **Defender** | T1 (frontline) | 120 | 0 (stationary) | 1.5 | 10 | 20 ticks (1.0 s) | 80 E + 10 C | 2 | 30 ticks (1.5 s) | Forge |
| **Raider** | T1 (harass) | 50 | 0.08 | 1.0 | 15 | 15 ticks (0.75 s) | 120 E + 10 C | 2 | 40 ticks (2.0 s) | Forge |
| **Vanguard** | T2 | 150 | 0.07 | 1.5 | 30 | 18 ticks (0.9 s) | 200 E + 30 F + 25 C | 4 | 80 ticks (4.0 s) | Forge (requires tier 2) |

`E` = Energy, `F` = Flux, `C` = own-faction colour (blue for faction 0, red for faction 1). `Supply` = supplyCost — consumed against the faction's `supplyCap` while the unit is alive (Phase 3.6).

Speeds are **tiles per sim tick** (sim runs at 20 Hz; multiply by 20 for tiles/second).

### Behaviour

- **Worker** — gathers from any live node (Energy or Flux). Cannot fight. Dies easily; carrying is lost on death.
- **Defender** — stationary garrison. Attacks any enemy unit that enters range.
- **Raider** — mobile harasser. Marches toward the enemy HQ along straight axes. Attack-priority chain: enemy unit in range → enemy structure in range → enemy HQ in range → keep marching.
- **Vanguard** — tier-2 raider. Same priority chain; bigger, slower, hits harder, longer range.

### Counter triangle (PRD §6.5)

Within tier 1: **frontline** (defender) counters **harass** (raider) counters **eco** (worker). Across tiers: vanguard stomps tier-1 in straight fights but commits an early-game window the opponent can punish.

Faction-asymmetric rosters are deferred to sub-phase **3.4**. Current units are shared across both factions.

---

## Structures

| Structure | HP | Cost | Build time | Role |
|---|---|---|---|---|
| **HQ** | 250 (configurable per match) | — | — (placed at match start) | Trains workers. Losing the HQ ends the match. |
| **Forge** (production) | 200 | 150 E + 30 C | 60 ticks (3.0 s) | Trains tier-1 combat units (defender, raider) and tier-2 (vanguard, post-research). Single training slot. |
| **Spire** (upgrade) | 150 | 100 E + 25 C | 40 ticks (2.0 s) | Hosts tier-2 research. Single research slot. |
| **Pylon** (supply) | 100 | 75 E + 15 C | 30 ticks (1.5 s) | Adds +8 to its faction's supply cap once operational. Killing one drops the cap (alive units are not retroactively killed). |

### Placement

- HQ positions are set in the match SPEC.
- Forge + Spire are placed by the player by clicking BUILD on the panel, then clicking a tile. Tile occupancy is not validated yet (3.10 will introduce real map data + collision). The AI places its Forge + Spire at deterministic offsets from its HQ.

### Combat

- All structures take damage from enemy units within attack range.
- Raiders + vanguards attack enemy structures as a priority slot between unit-combat and HQ-fallback. Killing an enemy Forge denies further combat-unit production until they rebuild.
- Defenders do not currently attack structures (only units). Faction-divergent defender behaviour arrives in 3.9.

---

## Tech

Single research available currently:

| Research | Cost | Time | Researched at | Effect |
|---|---|---|---|---|
| **Tier 2** | 50 F + 25 C | 80 ticks (4.0 s) | Spire | Unlocks Vanguard training at Forges. |
| **Trail Duration** | 40 F | 80 ticks (4.0 s) | Spire | Doubles `TRAIL_SEGMENT_LIFETIME` for the faction's energy-dump trails. |

The Spire's research slot is single-occupancy (Phase 3.7 added a `researchKind` discriminator so it can host either of the two researches above; only one runs at a time). Tech tree branches per faction arrive in 3.9. Faction-specific tech objectives (PRD §6.7 path 3) are stretch and may slip to Phase 4.

---

## Victory conditions

Currently a Phase 1 placeholder set:

- **HQ destruction** — destroy the enemy HQ. The other faction wins.
- **Score threshold** — first faction to `WIN_POINTS = 100` wins. Points come from kills (5 per unit) and HQ damage (1 per hit).
- **Hard timer** — not implemented yet. PRD §6.7 commits to a 25-minute hard timer with score tiebreaker; lands in sub-phase **3.6**.
- **Resign** — not implemented yet. Lands in 3.6.

The full PRD §6.7 set (military elimination requires HQ + all production destroyed, dominance-tick on Flux control, hard timer, resign) is sub-phase **3.6**'s deliverable.

---

## Controls

### Mouse

- **Left-click** an owned unit → selects only that unit (replaces any prior selection).
- **Shift + left-click** an owned unit → toggle that unit in or out of the current selection.
- **Left-click + drag** on empty ground → drag-rectangle. On release, every owned unit inside the rect joins the selection (shift-drag adds to the existing selection instead of replacing).
- With selected workers, **left-click** a node → all selected workers are assigned to harvest there. Selection *persists* — the workers stay highlighted so you can give a follow-up order. Node-pick takes priority over unit-pick when you have a selection, so clicking a node already being harvested by another worker assigns the current selection rather than re-selecting the busy worker.
- **Right-click** on empty ground → MoveUnit for every selected unit:
  - Workers cancel any harvest, walk to the tile, and stay parked there until you give them another order.
  - Raiders / vanguards take the tile as a temporary override of their march toward the enemy HQ; on arrival they resume default behaviour.
  - Defenders ignore the order (stationary).
- **Right-click** on an in-progress own structure (with worker(s) selected) → assign those workers to help build it. Multi-worker construction stacks throughput.
- **Right-click** during placement mode → cancels the placement (no move-order is issued).
- **Left-click on empty ground** → clears the unit selection. Selection only clears here or via Esc; it persists across orders so a single batch of workers can be reassigned without re-picking them every time.
- **Esc** → clears selection and cancels any pending placement.

**Phase 3.9.1 visual feedback.** A faction-coloured ring pings at the right-click target on every move order; a green pulse confirms an assign-to-node click; a brief burst confirms structure placement. The cursor switches to a crosshair while in placement mode and to a pointer when hovering over an own unit or a node — so the player can see at a glance what a click will do.

**Phase 3.9.3 visual scale.** All units render at ~1.8× their previous size; HQ at ~2.0×, Forge at ~1.9×, Spire and Pylon at ~1.4× — the catalog now reads at glance distance instead of as ant-sized silhouettes against the 32×32 grid. Sim is untouched (footprints are still 1 tile in the canonical state); the scale-up is renderer-only. AI Forge + Spire offsets pushed from (±2,±2) and (±1,0) to (±3,±3) and (±3,0) so the bigger meshes don't visually overlap the HQ.

**Phase 3.9.4 fog visualization.** The Tron grid is *uncovered* by vision: a dark layer covers the whole map by default; visible tiles drop the layer to transparent so the brightened grid lines (intensity bumped from 0.4 → 1.2 in the same sub-phase) shine through. Explored-but-not-currently-visible tiles stay mid-darkened — you remember they're there, but they fade. Unexplored tiles stay heavily dimmed (~92% alpha) so the unknown reads as a void carved away from the lit map. Composited per-pixel CPU-side via `min()` of falloff contributions, so overlapping vision sources don't compound. Observer mode bypasses entirely. Pure renderer; the explored bitmap lives outside sim state, the cross-OS gate is unaffected.

**Phase 3.9.5 audio.** Five Web-Audio-synthesized cues: UI button click, train complete (rising chime when a unit spawns), build complete (double tick when a structure goes operational), attack hit (noise burst when any friendly unit takes damage), HQ alert (pulsing low tone when the player HQ takes damage). Throttled to at most one of each type per tick, so combat doesn't spam. Mute toggle bound to **M** with a small status indicator top-right. No external audio assets — every sound is an oscillator + envelope. Renderer-side detection compares sim state across ticks; the deterministic sim is unaware.

**Phase 3.9.6 unit animations.** Newly-trained units scale-in from 40% to full size on spawn (legacy "placement pulse" — already existed in mesh code, surfaced through the wrapper interface and triggered by sim-renderer when it sees a unit ID for the first time). Units that die get a brief emissive flash before the mesh disappears — the visual stays alive in a "dying" pool until the pulse decays, so the player can see the death even if it happens between two right-click moves. Renderer-only; sim is untouched.

**Phase 3.9.7 main menu.** PvAI mode opens to a Tron-styled menu before the match begins — VYLUX title in glowing cyan, PLAY VS AI / MULTIPLAYER / OPTIONS buttons, faction picker placeholder. MULTIPLAYER + OPTIONS are stubs. **Post-2026-05-07 pivot:** MULTIPLAYER is now a relic — the dormant `?lockstep=host` URL flow still works for the dev loop, but multiplayer is not the product direction (see PRD §0). The button itself can stay or be hidden in a future menu pass. OPTIONS was waiting on a v4 binding-config UI commitment that's now been softened (PRD §3.7); whatever options screen lands will be PvE-scoped (volume, difficulty, perhaps a few rebind slots). `?menu=skip` URL param bypasses the menu (used by e2e tests + future deep-link share flows). Match-end overlay's RELOAD button returns to the menu naturally — no separate "back to menu" wire needed.

**Phase 3.10 in-game action bar (context-sensitive).** Replaces the Phase 1 always-on flat buildables panel with an action bar driven by current selection: HQ → TRAIN WORKER; Worker(s) → BUILD FORGE / SPIRE / PYLON + DUMP; Forge → TRAIN DEFENDER / RAIDER / VANGUARD; Spire → RESEARCH TIER 2 / TRAIL+; Pylon → info hint; mixed/empty → guidance text. Each button shows its hotkey letter, faction-coloured cost glyphs (E yellow, F green, C cyan/red), and tooltip-based disabled reasons. HQ + structures are now click-selectable (new selection rings on each); the input controller carries `selectedStructureId` + `selectedHqFaction` slots alongside the unit selection. Workers build buildings (PRD §6.3 "workers gather, deposit, and repair" extended): the player must train a worker before placing a Forge.

**Phase 3.10.4 worker spawn perimeter.** Newly-trained workers no longer appear on the HQ tile (selection collision + visual overlap with the bigger 3.9.3 HQ silhouette). They spawn on one of eight surrounding tiles via a deterministic round-robin (`FactionState.nextSpawnRotation` indexes a fixed offset table). Player explicit-tile spawns (TrainUnit with `x`/`y`) still honour the requested coords.

**Phase 3.10.5 deposit perimeter.** Returning workers stop at the HQ perimeter (~2-tile radius from HQ center) instead of walking onto the HQ centre tile. Visual cleanliness — workers are no longer hidden inside the HQ silhouette while depositing.

**Phase 3.10.6 worker-driven building.** New `BuildStructureByWorker` command (slot 11): the player selects a worker, picks BUILD FORGE / SPIRE / PYLON, then clicks a tile. The structure spawns at full `buildTicksRemaining` with `builtByWorker = true`; the assigned worker walks to the site and ticks construction down each tick while in range. Multiple workers stack contributions naturally (each contributes one tick per tick on site). Construction halts if the worker dies or is given a different command — the structure waits in build phase until another worker is dispatched. AI also uses the new path. Legacy `BuildStructure` (slot 4) retained for tests + back-compat — spawns structures with `builtByWorker = false` so they auto-tick the build phase.

**Phase 3.10.7 multi-worker building + construction visual.** Right-click on an in-progress structure with worker(s) selected fans out `AssignWorkerToBuild` (slot 12) per worker — additional builders accelerate the construction. Structures under construction now show a visible "rising from the ground" animation: the body's y-scale grows from 15% to 100% as build progresses, with a faction-coloured pulsing scaffolding ring at the base that fades when construction completes. Spire's finial only appears past 50% build progress; Pylon's cap past 40% — so the silhouette evolves through the build rather than just fading in.

### Action bar (Phase 3.10)

Bottom of screen, **driven by current selection**:

- Select your **HQ** (left-click) → **TRAIN WORKER**.
- Select a **Worker** (or several) → **BUILD FORGE / SPIRE / PYLON**, **DUMP**. Workers are the builders — to place your first Forge, train a worker first, then click it.
- Select a **Forge** → **TRAIN DEFENDER / RAIDER / VANGUARD**. Vanguard is shown but disabled until tier 2 is researched (hover for the reason).
- Select a **Spire** → **RESEARCH TIER 2 / TRAIL+**.
- Select a **Pylon** → info hint (no actions; Pylons just provide supply).
- Mixed unit selection → no actions; right-click moves them.
- Nothing selected → empty bar with a guidance hint.

Each button shows its hotkey letter, faction-coloured cost glyphs (E energy / F flux / C colour), and a tooltip explaining why it's disabled.

### Keyboard

- **R** — download the current replay as JSON. Useful for bug reports.
- **W / A / S / D** or **arrow keys** — pan the camera (continuous while held).
- **E** — activate energy dump on every selected dumpable worker (Phase 3.7).

### Camera (Phase 3.4)

- **Middle-mouse drag** — pan the camera. The world translates under the cursor (drag right = view shifts right).
- **Scroll wheel** — zoom in / out within 0.5×–2.0× of the default frustum height.
- Edge-scroll is intentionally not implemented — most players hate it as a default. May revisit in playtest.

The full keyboard suite (control groups, camera bookmarks, production hotkeys, idle-worker cycle, find-army cycle, queueing, smart-cast) was a v4 esport-pillar commitment. **Post-pivot (2026-05-07) it's softened to "comfortable mouse + hotkeys; rebindable bindings deferred"** — see PRD §3.7. The idle-worker hotkey is still planned (genuine quality-of-life); the rest only land if a PvE scenario design demands them.

---

## Current map

Single hardcoded map, defined in `src/main.ts`. Phase 3.4 expanded the grid from 20×20 to 32×32 to make room for the catalog still landing in 3.5+ (faction-locked colour nodes, Pylons, more contested zones).

- **Grid:** 32×32 tiles.
- **HQ positions:** faction 0 at (4, 4), faction 1 at (27, 27) — opposite corners.
- **Energy nodes:** six. Two near each HQ ((7,4), (4,7), (24,27), (27,24)) and two mid-distance "second base" nodes on the diagonals ((11,20), (20,11)). Each starts with 200 energy.
- **Flux nodes:** two at flank-symmetric positions ((9, 16), (22, 16)), 100 flux each. Equidistant between HQs but on different diagonals — committing to one means defending it instead of splitting attention. (Phase 3.6 split the lone central Flux into two flanks.)
- **Colour nodes (Phase 3.5):** two blue near faction 0 ((8,8), (2,10)), two red near faction 1 ((23,23), (29,21)). Each starts with 100 reserve and regenerates ~1 / sec back toward 100. Faction-locked — only the matching faction can harvest.
- **Starting pools:** 200 Energy + 50 Colour per faction. Pre-fund covers the opening worker batch; after that, the colour pool tracks harvest income.
- **Vision:** fog of war active (Phase 3.8). See "Vision + scouting" above. Each faction's home patch is auto-discovered at tick 0; the contested midfield + the opponent's home patch require scouting to see.
- **Terrain:** flat, no vision blockers, no impassable tiles. Sub-phase 3.10 introduces map data + terrain.

Multiple hand-tuned launch maps are sub-phase **3.10**'s deliverable; PRD targets 4–6 by Phase 4 launch.
