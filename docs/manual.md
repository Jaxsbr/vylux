# Vylux Manual

> **Audience:** anyone — players, internal alpha testers, agents, future-Jaco — who needs to know **what is currently in the game**, not the design vision behind it. This is the catalog. The vision lives in [`product/PRD.md`](product/PRD.md); the engineering history lives in [`investigation/`](investigation/).

> **Currency:** this file MUST be updated as part of any sub-phase that adds, removes, or re-tunes a unit, structure, resource, tech, or victory condition. The investigation-doc closing checklist enforces this, and the contract is mirrored in `AGENTS.md`. If the numbers in this file disagree with `src/sim/units-config.ts`, **the config wins** — patch this doc.

> **Last sub-phase that touched these numbers:** 3.8 (fog of war + node discovery).

---

## Resources

Three resources, in the shape PRD §6.3 commits to.

| Resource | Source | Used for | Notes |
|---|---|---|---|
| **Energy** | Energy nodes (most map nodes). Workers gather → return → deposit at HQ. | Workers, all structures, tier-1 + tier-2 combat units. | Plentiful, decentralised. Most nodes are Energy. |
| **Flux** | Flux nodes (small set, contested). Same gather-and-deposit loop; deposits to a separate pool. | Tier-2 research at the Spire, tier-2 unit production at the Forge. | Phase 3.1 added Flux as a distinct resource. The launch SPEC currently has 1 Flux node at the map centre. |
| **Colour** (Blue / Red) | Colour nodes — **faction-locked**: blue nodes only by faction 0 (cyan), red only by faction 1 (red-orange). | Every unit and every structure (small cost). Lockout-by-denial: pushed off your colour nodes → no production until you reclaim. | Phase 3.5. Colour nodes regenerate passively (~1 / sec) toward a 100-unit cap, so a denied faction recovers slowly. Energy + Flux nodes don't regen and still die at empty. |

**Worker model:** workers walk to a node, harvest for `HARVEST_TICKS` (~1 second), pick up `HARVEST_AMOUNT` clamped by `WORKER_CAPACITY`, walk back to HQ, deposit, and resume. Workers don't stand on a node and trickle. A worker assigned (manually or by auto-assign) to a foreign-colour node is silently dropped back to idle.

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
- With selected workers, **left-click** a node → all selected workers are assigned to harvest there.
- **Right-click** on empty ground → MoveUnit for every selected unit:
  - Workers cancel any harvest, walk to the tile, and stay parked there until you give them another order.
  - Raiders / vanguards take the tile as a temporary override of their march toward the enemy HQ; on arrival they resume default behaviour.
  - Defenders ignore the order (stationary).
- **Right-click** during placement mode → cancels the placement (no move-order is issued).
- **Esc** → clears selection and cancels any pending placement.

### Buildables panel

Bottom of screen:

- **WORKER / DEFENDER / RAIDER / VANGUARD** — train at HQ (worker) or first operational Forge (combat units). Disabled with reason text when prereqs unmet (`no forge` / `forge busy` / `tier 2 not researched` / `no flux` / `no <color>` / `supply blocked`).
- **BUILD FORGE** / **BUILD SPIRE** / **BUILD PYLON** — click, then click a tile to place.
- **TIER 2** / **TRAIL+** — research at the player's first idle Spire.
- **DUMP (E)** — for every selected dumpable worker, activate the energy-dump ability. Hotkey: `E`.

### Keyboard

- **R** — download the current replay as JSON. Useful for bug reports.
- **W / A / S / D** or **arrow keys** — pan the camera (continuous while held).
- **E** — activate energy dump on every selected dumpable worker (Phase 3.7).

### Camera (Phase 3.4)

- **Middle-mouse drag** — pan the camera. The world translates under the cursor (drag right = view shifts right).
- **Scroll wheel** — zoom in / out within 0.5×–2.0× of the default frustum height.
- Edge-scroll is intentionally not implemented — most players hate it as a default. May revisit in playtest.

The full keyboard suite (control groups, camera bookmarks, production hotkeys, idle-worker cycle, find-army cycle, queueing, smart-cast) is **Phase 4** — see PRD §3.8 + §6.9.

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
