# Investigation 04 — Phase 3 Faction & Map Depth

> **Status:** Open — sub-phases 3.0–3.10 closed; **3.11–3.14 repointed for the 2026-05-07 PvE pivot**; 3.11 next (now: enemy AI faction(s) for PvE).
> **Phase:** 3 (Faction & Map Depth — repointed PvE)
> **Owner:** Jaco
> **Created:** 2026-04-26
> **Time-box:** target 8–14 weeks of focused work
> **Depends on:** Phase 2 architecture (closed, now dormant — see PRD §0).

> **2026-05-07 — PvE pivot context.** Sub-phases 3.0–3.10 were built against the v4 PRD's competitive 1v1 esport target. The *mechanics* of those sub-phases (structures, two-resource economy, tech tiers, multi-select, fog, supply, energy dump, game-feel, action bar, worker-driven building) carry forward unchanged into the PvE direction. The remaining sub-phases (3.11–3.14) have been **repointed**: faction "asymmetry" becomes "enemy AI faction(s) with distinct rosters as the player's adversary"; maps-as-data adds seedable runs; win-conditions become PvE (survive-N-waves / scenario objective / boss); the playtest gate becomes "is the run loop fun." See PRD §8 Phase 3 + the 2026-05-07 decision-log entry at the bottom of this doc. Historical decision-log rows above are kept intact as the record of how we got here.

## Sub-phase status

| #    | Sub-phase                                                                | Status   |
| ---- | ------------------------------------------------------------------------ | -------- |
| 3.0  | Structures & production buildings                                        | ✅ Closed |
| 3.1  | Two-resource economy + worker rework                                     | ✅ Closed |
| 3.2  | Tech tiers + tier-2 units                                                | ✅ Closed |
| 3.3  | Multi-unit selection + move command                                      | ✅ Closed |
| 3.4  | Bigger map + camera pan/zoom                                             | ✅ Closed |
| 3.5  | Faction-locked color resource (regenerating, lockout-by-denial)          | ✅ Closed |
| 3.6  | Unit supply system + Pylons                                              | ✅ Closed |
| 3.7  | Worker energy dump + fading light trail + tech-upgradeable duration      | ✅ Closed |
| 3.8  | Fog of war + worker resource discovery (scouting)                        | ✅ Closed |
| 3.9  | Game feel & presentation pass                                            | ✅ Closed |
| 3.10 | In-game HUD / action-bar redesign (context-sensitive) + worker-build      | ✅ Closed |
| 3.11 | Enemy AI faction(s) with distinct rosters _(repointed PvE)_              | Pending  |
| 3.12 | Scenarios as data + seedable runs _(repointed PvE)_                      | Pending  |
| 3.13 | PvE win conditions (survive-N-waves + scenario objective + resign)        | Pending  |
| 3.14 | Run-loop playtest gate ("is the loop fun")                                | Pending  |

Each row links to the design notes in the corresponding `### 3.N — ...` section below.

### Session pickup — current sub-phase: 3.11 (PvE enemy AI faction)

A new session starting work on the next pending sub-phase should:

1. **Read PRD §0 (the pivot notice) first.** Vylux is now single-player PvE; do not propose new lockstep / ladder / spectator work. `src/net/` is dormant.
2. **Read the 3.11 section below** for scope, exit criterion, and sim-shape impact (now reframed for PvE).
3. **Read the closed sub-phase sections (3.0 through 3.10)** as worked examples — they show the standard work shape (types → state → commands → step → hash → AI → renderer → UI → tests → fixtures → verify gate). The work shape carries forward unchanged; only the *target* of the work has shifted.
4. **Read the Sub-phase closing checklist** further down. Five items: tsc clean, vitest green (regen `tests/determinism/` if sim shape moved), playwright green, `docs/manual.md` updated if catalog changed, status table + decision log updated.
5. **Sim-shape changes also bump `REPLAY_VERSION`** in `src/sim/replay.ts` — see the comment-header on that constant for the running history. Phase 3 is currently on v10 (after 3.10's worker-driven build).
6. **`CommandKind` IDs are append-only** — never reuse a slot. Pick the next unused number. See `src/sim/commands.ts` header + the `AGENTS.md` determinism contract.
7. **Multiplayer code under `src/net/` is dormant.** If a sub-phase needs to touch a file there for a non-trivial reason, that's a signal the pivot decision is being re-opened — surface it before changing anything. Tests under `src/net/` should keep passing; they're the safety net that the dormant code stays compilable.

UX micro-decisions not pre-specified in the 3.x sections (drag thresholds, right-click overload, shift-click toggle vs add semantics, between-wave UX details) are judgment calls — make a defensible pick, capture it in the closed sub-phase's "What landed" notes, and Jaco can redirect on review.

---

## Why this exists

PRD §8 Phase 3: _"Second faction, 4–6 launch maps, the counter-triangle redesign. This is where the game stops being a prototype-rewrite and starts being Vylux. Exit: internal playtests show no obviously dominant strategy or faction at tester skill — both factions are viable, both have win conditions, and at least two distinct build orders feel competitive on each map."_

Phase 1 ported the prototype mechanics onto a deterministic sim. Phase 2 made them networkable. The engine is now multiplayer-ready, but the game itself is mechanically thin: one symmetric faction, one hardcoded map, three units, HQ-trains-everything, no fog of war, no tech tiers, no real win-condition variety. A match boils down to "make raiders, march at HQ" — there is no scouting, no map control, no tier choice, no faction matchup.

Phase 3 turns that surface into the shape PRD §6 commits to. It is the biggest scope jump in the roadmap because every architectural pillar from §3.6 (asymmetry not breadth), §6.3 (two resources), §6.4 (production buildings + tech tiers), §6.5 (counter triangle), §6.6 (real maps), §6.7 (multiple win paths) lands here.

## Determinism cost (one-time)

The Phase 0 contract — same input → same hash, cross-OS — is preserved, but **the canonical state shape changes**. Adding structures, a second resource, fog state, and faction-asymmetric unit kinds all extend `SimState`. That moves `Sim.stateHash()` and invalidates:

- Every committed golden fixture in `tests/determinism/`.
- Every replay file produced before Phase 3 (which is fine — they were Phase 1 + 2 dev replays, not user-facing artifacts).
- The replay version bumps to 2.

This is a one-time payment, expected and budgeted. The cross-OS CI workflow stays in place; we regenerate the golden fixtures at the *end* of Phase 3 once the sim shape has stabilised, not after each sub-phase. During Phase 3 the workflow may be flaky — that's the trade.

`REPLAY_VERSION` bumps to 2 when the first state-shape change lands; existing v1 replays continue to parse but no longer validate against current Sim. We keep the v1 parser around for the duration of Phase 3 so old fixtures can be inspected, then drop it at Phase 3 close. As of close of 3.3 the version is **v5** — see the comment-block on `REPLAY_VERSION` in `src/sim/replay.ts` for the running history.

## Sub-phase closing checklist

Every sub-phase under Phase 3 closes with the following mandatory items, regardless of which slice of the catalog it touched:

1. `npx tsc --noEmit` clean.
2. `npm run test` green (regenerate `tests/determinism/` fixtures via `RECORD_GOLDEN=1` if the sim shape moved).
3. `npm run test:e2e` green — Phase 2 lockstep / observer / desync / replay gates still pass against the new sim shape.
4. **`docs/manual.md` updated** if the sub-phase added, removed, or re-tuned a unit, structure, resource, tech, victory condition, control, or the launch map. Same contract is captured in `AGENTS.md` so it carries forward to all future phases, not just Phase 3.
5. Sub-phase status table at the top of this doc updated.
6. Decision-log row added with date + one-line summary.

## Scope

### In scope (the Phase 3 deliverable)

- **Structures as first-class sim entities.** HQ is one structure; production buildings (per §6.4) are others. Structures have HP, faction, position, build time, and (for production buildings) an output queue and rally point. Structures can be destroyed.
- **Production buildings.** The HQ trains workers only. Combat units come from production buildings — faction-specific names but same architectural slot. Every faction has at least one tier-1 production building and one tier-2 production building.
- **Two-resource economy** (per §6.3). Energy from scattered nodes (current model, but deposit-based, not stand-on-node). Flux from a small number of contested nodes near map centre / contested zones. Tier-2 production gated on Flux.
- **Worker model rework.** Deposit-based: gather → return-to-dropoff → unload. Not the prototype's continuous-trickle. Idle workers are a real problem, addressed by §3.8's idle-worker hotkey.
- **Tech tiers.** Tier 1 from start; Tier 2 unlocked by an upgrade structure (faction-specific). Tier 3 — if it exists — gated on Flux + tier 2 prerequisites. Treat tier 3 as a stretch.
- **Fog of war** (per §6.2). Sim has full state; renderer filters per-faction. Vision provided by units (per-kind radius) and structures (HQ + production buildings). Terrain visible always; entity positions/types/state hidden outside vision.
- **Two asymmetric factions.** Different production-building lists, different unit rosters, different tech progressions. The §3.6 "depth via asymmetry" pillar is the shaping force — they should not be the same faction with reskinned units.
- **Counter-triangle.** Eco / Frontline / Harass at tier 1; specialist (siege / support / anti-frontline) at tier 2. Standard rock-paper-scissors within tier; higher-tier beats lower-tier of same role. Strong-against and weak-against published in-game (no datamining).
- **Win conditions** (per §6.7). Two viable per faction:
  1. Military elimination — HQ + all production destroyed.
  2. Map control / dominance — sustained Flux control accumulates dominance ticks toward a threshold.
  3. (Optional, faction-specific) Tech objective — stretch only, not a launch commitment.
  - Hard 25-minute timer with tiebreaker by score (per §6.1 + §6.7). Resign is a first-class action with replay save.
- **Real maps.** Data-driven map definition (loaded from JSON, hand-tuned). 2–3 launch maps in the Phase 3 deliverable; 4–6 by Phase 4 launch. Maps include: tile grid, energy node positions, Flux node positions, HQ start positions, and (per §6.6) vision-blocking terrain.
- **Playtest balance gate.** PRD-defined exit: internal playtests show no obviously dominant faction, two distinct build orders feel competitive on each map, neither faction is universally map-favoured.

### Out of scope (deferred to Phase 4 / Phase 5)

- **Glicko-2 ladder, seasons, ranked tiers.** Phase 4 territory. Phase 3 is internal playtest only.
- **Steamworks integration** (cloud saves, achievements, store). Phase 4.
- **Replay sharing UI** (browse, scrub, comment). Phase 5; Phase 3 keeps replays as JSON downloads.
- **Map elevation / high ground.** PRD §6.6 explicitly defers — adding correctly is expensive and post-launch can absorb it if the meta begs.
- **Procedural maps / random map pools.** PRD §6.6 explicit — hand-tuned only.
- **Mod tooling / custom maps.** PRD §5 explicit — out of scope forever for launch.
- **AI difficulty tiers.** Phase 1's scripted AI continues to exist as a sparring partner but per-faction AI tuning is Phase 4.
- **Full keyboard hotkey suite** (per PRD §3.8 / §6.9). Big chunk of work — control groups, camera bookmarks, production hotkeys, queueing, smart-cast. Phase 3 may add the simplest pieces (idle-worker hotkey is genuinely part of the §6.3 worker model) but the full surface lands in Phase 4 with the binding-config UI.

### Out of scope (forever, unless re-pitched)

- **Symmetric factions / cosmetic-only differences.** Pillar §3.6 is non-negotiable.
- **Pay-to-win, locked factions, gacha.** PRD §5 / §10.
- **Server-authoritative state.** Phase 0 contract.

## Sub-phases (rough sequence)

Each sub-phase ends with the cross-OS CI gate green (golden fixtures regenerated for the new state shape) and a commit on `main`. Replays produced after the start of a given sub-phase are valid against that sub-phase's sim, not necessarily earlier or later sub-phases — Phase 3 explicitly accepts that we're a moving target until 3.7 closes.

The sequence below prioritises **fun-per-sub-phase**, not foundation-perfect ordering. Jaco's stated motivation is "the game is boring right now" — each sub-phase should change how a match feels.

### 3.0 — Structures & production buildings ✅ closed

Promote structures to first-class sim entities. HQ continues to exist (and gains a `kind: 'hq'` discriminator) but no longer trains combat units. Add at least one tier-1 production building per faction (placeholder asymmetry — same kind, different name; faction-distinct rosters arrive in 3.4). Buildings have HP, are placeable on the grid, take build time, train units from a queue with a rally point.

This is the largest single sim change in Phase 3 — `SimState` gains a `structures: Structure[]` array, the build queue replaces the train-queue-on-faction-state, the renderer learns to draw buildings.

**Exit:** a player can place a production building, queue a unit, watch it spawn from that building (not the HQ), and the building can be killed by raiders, denying further production. Cross-OS gate green against new fixtures. ✅

**What landed:**
- `Structure` discriminated union in `types.ts` — currently a single `ProductionBuilding` kind. HQ stays on `FactionState` for now; migration into `structures` is deferred to a later sub-phase. `SimState.structures: Structure[]` is the canonical home.
- `BuildStructureCommand` (faction + kind + tile) and `TrainAtStructureCommand` (structureId + unitKind). `TrainUnit` is restricted at the sim level to workers — combat unitKinds are silently no-op'd, so any post-3.0 client that tries to train combat at HQ goes nowhere instead of desyncing.
- `step.ts` advances `state.structures` after units each tick: build phase counts down to operational, training phase counts down and spawns the unit at the structure tile on completion. Single-slot queue in 3.0 — multi-slot is a later refinement. Raiders gain enemy-structure as a third priority slot (between unit-combat and HQ-fallback) so a denied production building is a real economic disruption.
- `Sim.stateHash()` now serialises structures (id, alive, faction, kind, x, y, hp, build/train counters). This is the one-time hash format change called out in the doc; pre-3.0 golden fixtures don't validate against the new shape.
- `units-config.ts` gains `trainTicks` per unit kind (workers stay instant, defenders 30 ticks, raiders 40 ticks) and `PRODUCTION_BUILDING_STATS` (200 hp, 150 energy, 60 build ticks).
- AI: builds a Forge near its HQ when none exists, trains workers at HQ until the worker target is met, then trains combat units at the operational Forge. Single-Forge-per-match in 3.0 — multiple forges + tier-2 land in later sub-phases.
- Renderer: `buildProductionMesh` produces a faction-coloured low boxy structure with edge trim. Mid-build it renders dimmer / semi-transparent; once operational, full intensity. `SimRenderer.syncStructures` reconciles per frame.
- Player input: `BUILD FORGE` button on the buildables panel enters placement mode (next click on canvas issues a `BuildStructure` at the rounded tile). Combat-unit buttons are disabled while no operational Forge exists or while the Forge is busy training.
- `REPLAY_VERSION` bumped to 2.

**Gates added:**
- 7 new sim tests in `training.test.ts` cover BuildStructure cost-deduction, build-tick countdown, TrainAtStructure rejection while building / while busy, end-to-end train-and-spawn-at-tile, and raider attacking and killing a structure.
- Golden fixtures regenerated under `RECORD_GOLDEN=1`. Cross-OS determinism gate stays green; sim shape changed once, fixtures match the new shape now.
- All Phase 2 E2E tests pass against the new sim — lockstep agreement, observer in sync, desync detection, replay round-trip. The substrate-and-loop boundary held: nothing in `src/net/` needed changes, the sim shape extension travelled through unchanged.

**Lessons:**
- Restricting `TrainUnit` at the sim level (rather than just by convention) was the right call. Phase 0's anti-cheat-by-construction pillar pays off here: a tampered client can't bypass the HQ-trains-workers-only rule without producing a desync, because the rule lives in the canonical step function. The two-place-rule alternative (sim allows everything; UI/AI just doesn't use it) would have left a coordinated-cheat hole.
- Sim-work-per-tick increases widen cross-tab rAF jitter. Phase 2 E2E tick-skew tolerances were calibrated against the smaller 3.x sim; bumping them is correct, not papering over a bug. The lockstep determinism property — same hash for the same tick — held throughout, which is what the gate actually measures.
- The `FactionState.hqHp` / `hqX` / `hqY` fields are now an island: HQ behaviour lives on `FactionState` while every other building lives on `SimState.structures`. Migrating HQ into the structures array is doable but cross-cuts win conditions (3.6) + fog vision providers (3.3); deferring to one of those sub-phases keeps 3.0 contained. Flagged as carry-forward in the dispatch table for whichever sub-phase touches it first.
- `trainTicks` was added to the existing `UnitStats` rather than a separate config. Workers keep `trainTicks: 0` so the existing instant-train flow at HQ doesn't move; combat kinds use it via the production-building queue. One config, two paths through it — fine for now, may want to refactor when factions diverge in 3.4.

### 3.1 — Two-resource economy + worker rework ✅ closed

Add Flux as a distinct resource. Flux nodes are a small set of high-value tiles (pre-specced into the map data structure that 3.5 formalises). Workers gain a `resourceCarried` discriminator (`energy | flux`). Workers gather → walk to nearest dropoff → unload. The prototype's "stand on node and trickle" model is gone.

Tier-1 production stays Energy-only. Tier-2 production (introduced in 3.2) gates on Flux. The dropoff-based model also introduces the *real* idle-worker problem PRD §3.8 calls out.

**Exit:** an Energy-only economy still works; Flux is gathered and visible in the HUD; tier-2 placeholder cost validates Flux deduction; deposit-based worker loop is observable in the sim. ✅

**What landed:**
- `ResourceKind = 'energy' | 'flux'` discriminator. `EnergyNode` renamed to `ResourceNode` with `kind` field; legacy alias retained for source-compat. `Worker` gains `carriedKind`; `FactionState` gains `flux` + `tier2Researched`.
- `InitialMatchSpec.nodes` accepts an optional `kind` per node entry (defaults to `energy`). `initialFlux` parameter mirrors `initialEnergy` for tests that exercise Flux paths without harvesting. Main SPEC swaps the central node to `kind: 'flux'` — it sits equidistant between the two HQs, the natural contest point.
- Worker harvest stamps `carriedKind` from the node's kind; deposit credits `faction.energy` or `faction.flux` based on it. On-death + on-deposit both reset `carriedKind` to a canonical `'energy'` so determinism doesn't depend on historical state.
- `ResearchTier2` command — costs `TIER2_FLUX_COST = 50`, sets `factionState.tier2Researched = true`. Idempotent (silent reject if already researched). Tier-2 gameplay effects land in 3.2; here the flag exists to validate the deduction path.
- AI: spends Flux on tier-2 research as soon as affordable. Routes one worker to the nearest live Flux node while pre-research (lowest-ID candidate not currently harvesting/returning). Reassignment is idempotent — same worker every AI tick — so the `AssignWorkerToNode` command stream is deterministic and the worker pings between Flux-harvest and Flux-deposit until the research goal is met.
- Renderer: Flux nodes render with a bright green rim (`0x66ff44`) instead of the legacy pale-cyan. Visually unambiguous against the cyan/red faction palette.
- HUD shows `f <flux>` alongside `e <energy>` per faction, plus a `t2` tag once researched.
- `Sim.stateHash()` extended for `flux`, `tier2Researched`, node `kind`, worker `carriedKind`.
- `REPLAY_VERSION` → 3.

**Gates added:**
- 4 new sim tests in `training.test.ts`: worker harvests Flux node and deposits to `faction.flux` (energy unchanged), `ResearchTier2` deducts Flux and sets the flag, `ResearchTier2` silently rejects when underfunded, `ResearchTier2` is idempotent on re-issue.
- Golden fixtures regenerated under `RECORD_GOLDEN=1`. All 9 E2E continue to pass against the new sim shape — Phase 2 lockstep / observer / desync / replay still green; the substrate-and-loop boundary held for the second consecutive sub-phase.

**Lessons:**
- The deposit-based worker loop already existed from Phase 1 (workers gather → return → deposit). The doc text in 3.1 was written assuming the prototype's older "stand on node and trickle" model that Phase 1 had already replaced. 3.1's actual work was *making the resource pipeline two-channel*, not *introducing deposit-based gathering*. Worth re-reading the PRD's investigation prose against the current code, not the historical mental model — when the prose lags reality, trust the code.
- The kind-agnostic `nearestLiveNode` would have starved Flux of any throughput in AI play (workers always pick the closer Energy node). Adding a deterministic single-worker bias toward Flux while pre-research is the smallest change that makes the pipeline observable end-to-end. A smarter "balance N workers across resource kinds" AI is a 3.7 tuning concern, not a 3.1 architectural one.
- Resetting `carriedKind` to a canonical `'energy'` whenever `carrying === 0` was a deliberate determinism call. The alternative — leaving the field as the last-carried value when the worker is empty — would have produced two different hashes for identical-feeling states (worker carrying 0 Energy vs worker carrying 0 Flux). Same lesson as Phase 0: any field that affects the canonical hash must have a single canonical representation for each effective state.

### 3.2 — Tech tiers + tier-2 units ✅ closed

Add an upgrade structure (faction-specific) that, when constructed + researched, unlocks tier-2 production. Add one tier-2 unit per faction (placeholder asymmetry; full faction divergence lands in 3.4). Tier-2 unit cost includes Flux. Counter-triangle within tier emerges (frontline vs harass vs eco at tier 1; tier 2 stomps tier 1 of same role).

**Exit:** a player can research tier 2, build a tier-2 unit, and observe that it beats tier 1 in straight fights but costs an early-game window the opponent can punish. ✅

**What landed:**
- `StructureKind` extends to `'production' | 'upgrade'`. New `UpgradeStructure` interface (kind: 'upgrade', `buildTicksRemaining`, `researchTicksRemaining`); same build-phase semantics as production buildings, plus a research phase that's idle (0) when not actively researching.
- `UnitKind` adds `'vanguard'` — the tier-1 placeholder tier-2 unit (faction-asymmetric tier-2 rosters arrive in 3.4). Stats: 150 HP, 30 damage, 1.5 range, 18-tick cooldown — beats raiders in straight fights but costs 200 energy + 30 flux + 80 train ticks (~4 s), opening the early-aggression window the opponent can punish.
- `UnitStats` gains `trainFluxCost` + `requiresTier2`. `STRUCTURE_STATS` becomes a `Record<StructureKind, StructureStats>`; the upgrade entry is cheaper to build than a Forge (100 vs 150 energy) but commits the build window similarly.
- Commands: `BuildStructure` now dispatches by kind for cost lookup. `ResearchTier2AtStructure` (CommandKind 7) replaces 3.1's standalone `ResearchTier2` (CommandKind 6 retained as a reserved/dead enum slot per the never-reuse-IDs rule). `TrainAtStructure` for vanguard verifies `tier2Researched` AND deducts both energy + flux.
- Sim: `advanceStructure` handles upgrade kind — build phase counts down to operational; once operational, research can run. On research-complete, sets `factions[s.faction].tier2Researched`. Vanguard combat reuses raider's priority chain via generic helpers.
- AI: build order is `workers → Forge → Spire → research → defenders → vanguards (post-research, prefers them over raiders)`. Spire placement is a deterministic offset from HQ on a different axis from the Forge so they don't overlap.
- Renderer: `buildSpireMesh` produces a tall slim cylinder with a glowing finial (visually distinct from the Forge's box); `setBuildProgress` fades the body during construction; `setResearchProgress` pulses the finial brighter while research runs. Vanguard is a 1.5x-scaled raider mesh (faction-asymmetric tier-2 visuals come in 3.4).
- Player UI: `BuildablesPanel` gains BUILD SPIRE + RESEARCH TIER 2 + VANGUARD buttons. Existing buttons remain. Reason text spells out `no forge` / `forge busy` / `tier 2 not researched` / `no flux` so the player can see why anything's disabled. `InputController.pendingPlacement: 'production' | 'upgrade' | null` replaces the boolean from 3.0; right-click + Esc cancel any pending placement.
- `REPLAY_VERSION` → 4.

**Gates added:**
- 5 new sim tests in `training.test.ts`: BuildStructure(upgrade) cost-deducts + spawns Spire; ResearchTier2AtStructure rejected on still-building Spire; research completes after `TIER2_RESEARCH_TICKS` and sets the flag; vanguard training rejected pre-research; vanguard training post-research deducts both pools.
- AI build-order test rewritten to track the `workers → Forge → Spire → defenders → raiders` shape that 3.2 emits in scenarios with enough energy.
- Golden fixtures unchanged: in the AI-vs-AI scripted scenario the AI never accumulates 100 energy past Forge construction (combat unit costs 80–120 drain it back faster than workers can rebuild it). The 3.2 build-order changes are real but don't fire in the lean energy budget of the headless gate. Live SPEC has `initialEnergy: 200` so player matches DO see the new structures.

**Lessons:**
- The "never reuse a command-kind ID" rule from `commands.ts` paid off cleanly here. `ResearchTier2` (slot 6) is dead in 3.2 but kept reserved; `ResearchTier2AtStructure` is slot 7. Replay v3 files that contained `kind: 6` parse without crashing — the dispatcher's switch falls through silently — so old replays don't blow up the runtime even though they no longer validate the current hash.
- The same gating pattern keeps appearing — sim-level validation on TrainAtStructure (not-yet-operational, busy, requiresTier2, insufficient resources) is a four-line stack of `if (...) return` guards. PRD §3.7's anti-cheat-by-construction posture is paying for itself: each rule lives in the sim and a tampered client would either obey or desync.
- Bulk `sed` rename from `PRODUCTION_BUILDING_STATS` to `STRUCTURE_STATS.production` broke import statements (you can't have a `.` in an import binding). Caught by tsc immediately. Lesson: when refactoring a symbol that lives both in import lists and in expressions, do them in separate passes or use the editor's rename-symbol tool. Bulk text replace is faster but requires a careful read of the diff before commit.
- Stale prose in the sub-phase doc — same issue as 3.1. The 3.2 entry mentioned "faction-specific" upgrade structure naming. With faction asymmetry deferred to 3.4, both factions field the same generic Spire here. Worth re-reading sub-phase prose against the cumulative state of earlier closed sub-phases rather than the original PRD vision.

### 3.3 — Multi-unit selection + move command ✅ closed

Player-control foundation. The Phase 1 input model only supported single-unit select-and-assign-harvest. To exercise the growing catalog the player needs drag-rectangle selection, shift-click to extend the selection, and right-click-to-move issuing a `MoveUnit` command for every selected unit at the clicked tile.

**Exit:** a player can box-select multiple units and right-click them to a tile; they walk there together; raiders / vanguards then resume their default march; workers stay parked there until reassigned. ✅

**What landed:**
- `UnitBase` gains a nullable `moveTarget: { x: Fixed; y: Fixed } | null`. The field lives on the base (not per-kind) so the hash slot is uniform across all unit kinds — defenders carry a permanently-null slot they ignore, but the slot still hashes the same as for any other unit.
- `MoveUnitCommand` (`unitId`, `x`, `y`) at `CommandKind.MoveUnit = 8` — the next free slot after 3.2's `ResearchTier2AtStructure = 7` (slot 6 still reserved/dead for the deprecated 3.1 `ResearchTier2`, per the never-reuse-IDs rule).
- `step.applyCommand` for `MoveUnit`: dispatch by unit kind. Workers drop their harvest target (`phase = 'idle'`, `targetNodeId = 0`, `harvestTicksRemaining = 0`) and adopt the new `moveTarget`. Raiders + vanguards just adopt the `moveTarget`. Defenders silently no-op (`return` before setting the field).
- `advanceWorker` (idle phase): when `moveTarget !== null`, walk toward it; on arrival snap to the integer tile centre and leave `moveTarget` set so the worker stays parked. The "sticky moveTarget" decision is what defends against `autoAssignIdleWorkers` immediately re-routing a parked worker to the nearest node.
- `advanceRaider` / `advanceVanguard`: combat priority chain (enemy unit > enemy structure > enemy HQ) preempts the override; once disengaged, walk to `moveTarget` instead of enemy HQ; on arrival, clear `moveTarget` and resume default behaviour next tick.
- `autoAssignIdleWorkers` skips workers whose `moveTarget !== null`. Without that, the player's move-order would be erased by the next auto-assign sweep.
- `applyDamage` clears `moveTarget = null` on death so dead-unit hash slots are canonical (same shape as the existing `carriedKind = 'energy'` reset on worker death).
- `Sim.stateHash()` extends every unit slot with a presence flag (u32) + 2 Fixed coords. `REPLAY_VERSION` bumps to 5.
- `InputController` rewritten for multi-select. `selectedUnitIds: Set<number>` replaces the single-ID field. Drag-rect with a 5 px threshold (small drags fall through to click semantics); pointer-capture so a fast drag past the canvas edge still resolves; an HTML overlay div renders the rect. Drag-rect selection projects each owned unit's sim position to client pixels via `tileFloatToWorld` + `Vector3.project(camera)` — independent of mid-frame interpolation. Shift modifier additive vs replace, locked at pointerdown for the whole drag. Plain left-click on a node with selected workers fans out an `AssignWorkerToNode` per selected worker. Right-click on empty ground fans out a `MoveUnit` per selected non-defender, alive unit. Right-click during placement still cancels placement (no move-order issued).
- `SimRenderer.applyInputVisuals(ReadonlySet<number>)` — selection rings now reflect the full set.
- `main.ts` HUD/header comment updated for the new control set; `getSelectedUnitId` → `getSelectedUnitIds` plumbing.

**Gates added:**
- 4 new sim tests in `training.test.ts` (Phase 3.3 block): worker `MoveUnit` cancels harvest + walks + parks (sticky); raider `MoveUnit` overrides march + clears on arrival + resumes default; defender `MoveUnit` silent no-op (field stays null, position unchanged); `MoveUnit` against an unknown ID silent no-op.
- Golden fixtures regenerated under `RECORD_GOLDEN=1`. Every committed `tests/determinism/*.hashes.json` line moved (sim hash format extended); the four golden tests + the two AI-determinism gates pass against the new sim. All 9 Playwright e2e gates (lockstep, WebRTC lockstep, observer, desync detection, replay round-trip, mouse, select, smoke, preview) continue to pass — the substrate-and-loop boundary held for the third consecutive sub-phase.

**Lessons:**
- The "sticky moveTarget for parked workers" decision was the load-bearing design call. The naive "clear on arrival" version interacted badly with `autoAssignIdleWorkers`: the player's move-order survived a single tick and then was erased by the auto-assign sweep, with no visible cause. Two correct responses to the conflict: (a) make the auto-assign smarter (skip workers with a player order), or (b) make the move target sticky so the worker stays in the "I have an order" state. We did both — they reinforce each other and either alone has a worse failure mode (a) without (b) means workers re-route the moment another command lands; (b) without (a) means the auto-assign still races on the same tick.
- The hash-format rule "every kind hashes the same slot, even if some kinds always set it to null" was non-obvious but paid off. The alternative — only hash `moveTarget` for workers / raiders / vanguards — couples the per-kind logic to the hash format, and adding a new combat-capable kind in 3.4+ would silently miss the slot. Putting the field on `UnitBase` and writing the slot unconditionally in `hashUnit` keeps the contract uniform.
- The pre-existing `hashUnit` switch was missing an explicit `'vanguard'` case (the function fell through and returned implicitly — correct because vanguard had no per-kind extras, but easy to miss when the next per-kind field lands). Added the explicit case while extending the function. Worth re-reading switches over discriminated unions whenever the union grows; TS doesn't enforce exhaustiveness when the function returns void.
- Drag-rect selection in screen space using `Vector3.project(camera)` is the simplest correct read for an orthographic isometric camera. The 5 px threshold is critical — without it, every click registers as a zero-area drag and the "click on empty space deselects" path is unreachable. Same lesson as RTS muscle memory: tiny mouse jitter is normal and the input layer must absorb it.
- Right-click "fans out a MoveUnit per selected unit" rather than a single `MoveUnitGroup` command. Lockstep cost is one network message per unit — tolerable at the unit counts the sim handles. A group-move command would be a bandwidth optimisation and a determinism-format change for one rare case; deferred until profiling says it matters.

### 3.4 — Bigger map + camera pan/zoom ✅ closed

The Phase 1 20×20 grid was cramped for the growing catalog (4 unit kinds, 3 structure kinds today; Pylons + per-faction colour nodes still landing). 3.4 expanded the grid to 32×32 and added the camera controls needed to navigate it — so 3.5 (colour resource) + 3.6 (supply / Pylons) inherit a usable map without retrofitting another scale-up.

**Exit:** player can pan to view the enemy base and zoom in/out; the dev build shows the larger grid with HQs + nodes laid out for it; lockstep / observer / replay gates all pass against the larger grid. ✅

**What landed:**
- `GRID_CONSTANTS.gridSize` 20 → 32; `worldExtent` is now derived from `gridSize * tileSize` rather than a hardcoded 20, so a future bump is one constant. `src/grid.test.ts` rewritten to be parametric on `GRID_CONSTANTS.gridSize` — no more hardcoded 9.5 / 400 / 19 anywhere in the test file. Out-of-bounds cases also derived from `N`.
- `src/render/scene.ts` cleaned up: the `-10 + 0.5` literal in `tileFloatToWorld` is now `-worldExtent/2 + tileSize/2` derived from `GRID_CONSTANTS`. `DEFAULT_HALF_HEIGHT` exported and derived from `worldExtent / 2 + 6` so the default zoom-out comfortably frames the bigger grid plus margin. Camera offset (the iso angle from look-at target) scaled with `worldExtent` so the angle stays the same as the map grows. New `setHalfHeight(halfHeight)` method on the scene bundle so the camera controller can drive zoom without owning the camera.
- New `src/render/camera-controller.ts`. Pure presentation, no sim references. Owns: look-at target (Vector3), zoom scale (1.0 default, clamped to `[ZOOM_MIN, ZOOM_MAX]`), held-keys set. Pan via middle-mouse drag (button 1) — pixel deltas → world deltas via the current frustum width / canvas client width. Pan via WASD/arrows — continuous in `update(dtSeconds)`, normalised so diagonal isn't √2× faster, integrated per-rAF. Zoom via scroll wheel — multiplies the scale by `1.1^±1` per notch. Pan target clamped to ±0.6 × worldExtent so the player can scroll past the edge for context but can't lose the map.
- `src/main.ts` SPEC re-tuned for the 32×32 grid: HQs at (4, 4) and (27, 27); two Energy nodes near each HQ; two mid-distance "second base" Energy nodes on the diagonals at (11, 20) and (20, 11); contested Flux node dead centre at (16, 16). The Flux still sits equidistant between HQs (≈18 tiles from each) — the natural contest point.
- `bootstrap()` instantiates `CameraController`, drives `update(dt)` from the existing HUD rAF loop using `performance.now()` deltas (clamped to 0.1 s so a long tab-switch doesn't catapult the camera on resume), and calls `detach()` on `beforeunload`.
- `docs/manual.md` updated: Controls section gains the Camera block (middle-mouse pan, WASD pan, scroll-wheel zoom, edge-scroll explicitly deferred); Current map section updated for 32×32 + new HQ + node positions; cross-references to fog-of-war (now 3.8) and maps-as-data (now 3.10) corrected from the stale 3.3 / 3.5 references.

**Gates added:**
- No new sim tests — sim shape did not move and 3.4 is renderer-only. The 13 existing `grid.test.ts` tests all pass against the new 32×32 + parametric assertions (silent regression check that nothing in the repo accidentally hardcoded a 9.5 / 19 / 400 against a future grid bump).
- All 140 unit tests stayed green without regenerating any golden fixture — confirming that the determinism boundary held: the scripted-match fixtures own their own SPECs and never read `GRID_CONSTANTS`, so a presentation-layer change cannot move sim hashes.
- All 9 Playwright e2e gates (lockstep, WebRTC lockstep, observer, desync detection, replay round-trip, mouse, select, smoke, preview) continue to pass against the new map. Production `npm run build` clean.

**Lessons:**
- The single hardcoded `-10 + 0.5` in `scene.ts` was a Phase-1 "I'll come back to this" that survived through 3.3 because nothing exercised it — `worldExtent` was 20 across the whole codebase, so the literal happened to be correct. The risk wasn't the bug, it was the next person bumping `GRID_CONSTANTS.gridSize` and watching the unit positions drift sideways with no obvious cause. Lesson: when a literal duplicates a derived value, even briefly, leave a comment that says "derive this when something else moves" — or just derive it now. We did the latter on this pass and the bigger-map work fell out cleanly.
- `grid.test.ts` had four assertions baked to 9.5 / 19 / 400. Each was correct against the 20×20 grid and would have produced misleading failures against 32×32 (test intent: "tile (19,19) should be at the far corner" — true for `gridSize === 20` only). Rewriting them as `tileToWorld(N - 1, N - 1)` against the constant turns the same property check into one that survives the next grid bump too. Same lesson as the `scene.ts` literal: tests against constants should reference the constants.
- Deriving the camera offset from `worldExtent * (0.9, 1.1, 0.9)` was the load-bearing call for keeping the iso angle stable. The naive port (just keep `(18, 22, 18)` from the 20-grid) flattens the camera against a 32-grid because the lookAt target stays at origin but the camera relative-distance shrinks proportionally — the view ends up tilted toward the floor instead of the iso pitch. Scaling the offset with the grid keeps the angle identical for any grid size. Worth flagging for 3.10's maps-as-data sub-phase: per-map grid sizes should plug into the same derivation.
- `CameraController.update(dt)` driven by `performance.now()` deltas in the rAF loop — with a 0.1 s clamp — is the standard "don't catapult the camera after a long tab-switch" guard. Without the clamp, a 30 s background pause integrates 30 s × 12 wu/s = 360 wu of pan in a single tick the moment the tab refocuses. Cheap to add, awful to debug if missed.
- Pan + zoom both fight the input controller's right-click semantics in subtle ways — luckily 3.3 spec'd middle-mouse for pan (no overlap with right-click move-order) and the wheel doesn't conflict with anything. The temptation to "just use right-click drag for pan" would have collapsed move-orders the moment the player accidentally moved the cursor. Discipline of "right-click is sim semantics, middle-click is camera" worth preserving as more controls land.

### 3.5 — Faction-locked color resource (regenerating, lockout-by-denial) ✅ closed

Per the design ask: a third resource that's faction-locked, where each team can only harvest its own colour (Faction 0 = Blue, Faction 1 = Red). Required for **every unit and every building**. The lore is that the team's identity colour comes from this resource. It regenerates over time so it isn't a hard scarcity, but the enemy can deny access to it via map control — a player pushed off their own colour nodes loses the ability to train or build until they reclaim them.

**Exit:** a faction can train units and build structures only when it has both Energy and its own colour resource; pushing the enemy off their colour nodes locks them out of production until they recover; lockstep + replay round-trip + cross-OS determinism gates all pass. ✅

**What landed:**
- `ResourceKind` extends to `'energy' | 'flux' | 'blue' | 'red'`. New `FACTION_COLOR: Record<Faction, 'blue' | 'red'>` const in `types.ts` is the single source of truth that maps faction 0 → 'blue', faction 1 → 'red'. The cost-path checks in `step.ts` and the AI's worker-routing both consult it; a Phase-4+ "third faction with green colour" lands as one extra row.
- `FactionState` gains `color: Fixed`. `ResourceNode` gains `regenPerTick: Fixed` + `maxReserve: Fixed`.
- `UnitStats.trainColorCost` (workers 5, defenders 10, raiders 10, vanguards 25). `StructureStats.buildColorCost` (Forge 30, Spire 25). `TIER2_COLOR_COST = 25`. New `COLOR_NODE_STATS` (maxReserve 100, regenPerTick 0.05 → ~1 per second; a fully-depleted colour node refills its 100 reserve in ~100 seconds).
- `step.applyCommand` for every cost path (`TrainUnit`, `BuildStructure`, `TrainAtStructure`, `ResearchTier2AtStructure`) adds a colour-cost check + deduction. `AssignWorkerToNode` silently rejects opponent-colour assignments (defence-in-depth helper `canHarvest(faction, node)` centralises the rule). Worker harvest also re-checks `canHarvest` and drops the worker back to idle if a node-kind change has rendered the assignment illegal — the rule lives in two places intentionally so a future code path can't bypass it.
- New `step.advanceNode` pass between unit-advance and structure-advance: heals each colour node's `remaining` toward `maxReserve` by `regenPerTick`, capped. Energy + Flux nodes have `regenPerTick === 0` so it's a no-op for them.
- New "regen-zero nodes die at empty" rule. Energy + Flux still die at depletion (existing behaviour); colour nodes don't (regen would be unreachable if they did, defeating the lockout-by-denial recovery curve). Worker harvest also drops the worker back to idle if `actuallyTaken === 0`, so a worker doesn't lock onto a depleted colour node and waste cycles.
- Worker deposit credits the right pool: Energy → `faction.energy`, Flux → `faction.flux`, blue/red → `faction.color` (with a faction-match guard, so a workplace-bug worker carrying foreign-colour silently no-ops the deposit rather than crediting the wrong faction).
- `Sim.stateHash()` extends FactionState's slot with `color`, every node's slot with `regenPerTick + maxReserve`, and `resourceKindToInt` adds `blue=2, red=3`. `REPLAY_VERSION` bumps to 6.
- AI generalises the 3.1 single-flux worker bias to also include own-colour: when `faction.color < 50`, route one worker to the nearest live own-colour node (lowest-ID tiebreaker, skipping depleted nodes). `autoAssignIdleWorkers` now uses `nearestHarvestableNode(state, faction, ...)` which filters opposite-colour and depleted-colour nodes — without that filter the AI emits a doomed AssignWorkerToNode every tick that the sim silently rejects, cluttering the input log + replay. Combat-train + build-order checks include colour cost so the AI doesn't spam doomed commands when the colour pool is empty.
- `main.ts` SPEC adds 4 colour nodes — two blue near faction 0's HQ ((8,8), (2,10)), two red near faction 1's HQ ((23,23), (29,21)). `initialColor: 50` pre-funds the opening worker batch (covers ~10 worker trains worth before harvest income takes over).
- HUD line shows `c <color>` alongside energy + flux. `BuildablesPanel` adds an `affordableColor` check on every train/build button + a `no <color>` reason when blocked by colour. The reason ordering puts "no forge" / "forge busy" / "tier 2 not researched" / "no flux" before "no <color>" so the most actionable block surfaces.
- Renderer: `buildNodeMesh` extends the rim-tint dispatch to include faction-palette colours for blue (cyan rim, `0x00e5ff`) and red (red-orange rim, `0xff6a33`) — the same palette as the unit/HQ emissive, so the player reads "this is your colour" by sight without consulting a legend.
- `AI_VS_AI_SPEC` (the golden-fixture scripted match) gains one blue + one red node + `initialColor: 100` so the AI can actually run a meaningful match. Without that, the determinism gate degenerates into "no AI activity for 3000 ticks" because workers can't be trained without colour. Same fix applied to `win.test.ts` AI-progress scenario.

**Gates added:**
- 6 new sim tests in `training.test.ts` (Phase 3.5 block): own-colour harvest deposits to `faction.color` (energy + flux unchanged); opposite-colour `AssignWorkerToNode` silently rejected; colour-node regen ticks toward maxReserve and caps; depleted colour nodes stay alive while energy nodes die at empty; `TrainUnit` rejected on `initialColor: 0`; `BuildStructure` + `TrainAtStructure` + `ResearchTier2AtStructure` all gate on colour with the right reject semantics.
- All 146 unit tests pass after `RECORD_GOLDEN=1` regenerated the four golden fixtures (the sim hash format moved with the new FactionState + ResourceNode fields).
- All 9 Playwright e2e gates green against the new sim. Production `npm run build` clean.

**Lessons:**
- The "lockout-by-denial only matters if the colour nodes are denyable" framing was the load-bearing design call. Tucking colour nodes deep in the home base would have made colour effectively limitless; placing them at the edge of the home patch — reachable from the open midfield — is what makes the mechanic produce real raid-vs-defend tension. Same shape as PRD §6.6's "geographically committal" Flux: the resource exists to create map-control fights.
- The colour-node regen rate was the most fragile knob in the sub-phase. 1 / second (0.05 / tick) was picked because: (a) it's slow enough that a 1-minute push off your colour costs ~60 colour, equivalent to 6 raiders worth of training, real economic damage; (b) it's fast enough that a denied faction recovers in ~2 minutes, not 20. Faster regen trivialises the mechanic; slower means the loser snowballs into elimination. Numbers will move in 3.12 playtest tuning, but the *shape* — minute-scale lockout, recovers without intervention — is the load-bearing commitment.
- The decision to keep colour cost on workers (5 each) instead of "workers are exempt" was non-obvious. Exempting workers means a denied faction can still bootstrap its way back: train workers to colour-harvest, train units. That degenerates the mechanic into "small economic setback." Charging workers means the faction starts running out of bootstrap capacity if denial drags on — exactly the squeeze PRD §6.5's macro-pressure pillar wants. The 5-cost is small enough that the SPEC's `initialColor: 50` covers the opening worker batch comfortably; it bites only when sustained denial drains the pool.
- "Defence in depth" for the harvest gate (`canHarvest` checked at both `AssignWorkerToNode` and inside `advanceWorker`'s harvest phase) was deliberate. The single-place rule would have been simpler, but a future sub-phase might add a code path that mutates a worker's `targetNodeId` directly (e.g., the energy-dump trail in 3.7 might include a "drag selected workers to safety" action). With the gate also at harvest time, any path that lands a worker on a foreign-colour node fails-safely back to idle rather than depositing colour to the wrong faction. Cheap belt-and-braces; same posture as PRD §3.7's anti-cheat-by-construction.
- The "energy/flux nodes die at empty, colour nodes don't" asymmetry needed an explicit predicate in the sim (`if (node.remaining <= 0 && node.regenPerTick === 0) node.alive = false`). The naive port — "always die at empty" — would have made colour nodes vanish the moment the last unit harvested them, forcing players to wait for a respawn that never comes. Worth flagging that as the canonical pattern for any future regen-capable resource: regen-bearing nodes never die at empty.
- The SPEC + golden-fixture fall-through was a real cost. Adding colour costs to every existing path also broke `win.test.ts`'s AI-progress scenario and the cross-OS determinism `AI_VS_AI_SPEC` because their pre-existing energy budgets didn't account for the new colour gate. Each needed `initialColor` + at least one colour node per faction so the AI could actually run. Lesson: when a sub-phase adds a new mandatory cost dimension, audit every test fixture + scripted match for under-funding before regenerating golden fixtures, or the regen will lock in a static-state baseline.

### 3.6 — Unit supply system + Pylons ✅ closed

The pre-3.6 sim capped nothing — a faction with infinite resources could spam infinite raiders. 3.6 adds the standard RTS supply gate (initial cap 10, +8 per Pylon) so the player has to commit a base-management decision (build Pylons) to scale their army. Landed after 3.5 so Pylons inherit the colour cost from day one — no retrofit.

**Exit:** player can hit the supply cap and unlock more by building Pylons; AI does the same; a match can cycle through the full unit catalog and reach tier-2 economy without running out of Energy. ✅

**What landed:**
- `FactionState` gains `supplyCap: number` + `supplyUsed: number`. Both integers (no Fixed needed — supply is countable). `SUPPLY_CAP_INITIAL = 10`, `SUPPLY_CAP_BONUS_PER_PYLON = 8`.
- `UnitStats.supplyCost` per kind: worker 1, defender 2, raider 2, vanguard 4. Placeholder numbers tuned in 3.12.
- `StructureKind` extends to `'production' | 'upgrade' | 'supply'`. New `SupplyStructure` interface — build-phase only, no train queue, no research. `STRUCTURE_STATS.supply`: 100 hp, 75 E + 15 C, 30 tick build (~1.5 s).
- `TrainUnit` (workers at HQ) + `TrainAtStructure` (combat at Forge) silently reject when `supplyUsed + supplyCost > supplyCap`. Sim-enforced so a tampered client can't bypass.
- **Reservation model:** `TrainAtStructure` reserves the supply slot at queue time (bumps `supplyUsed`), not at unit-spawn time. Without this, a player with two Forges could queue two units in one tick that together would exceed the cap, both passing the queue-time check and pushing past the cap on completion. The reservation also centralises so a follow-up TrainAtStructure on a second structure correctly sees the in-flight bump. `TrainUnit` is instant (workers train at HQ with `trainTicks=0`), so for that path queue and spawn collapse to one bump.
- **Centralisation refactor:** `spawnUnit()` (in `state.ts`) deliberately does NOT bump `supplyUsed` — callers do. The queue path (`TrainAtStructure`) bumps at queue time; the instant path (`TrainUnit`, dev-only `SpawnUnit`) bumps at spawn. Spawn-from-completion in `advanceStructure` does NOT bump (already reserved). Comments in both files document the rule so the next contributor doesn't add a stray double-count.
- `applyDamage` decrements `supplyUsed` on unit death. Single chokepoint for every kill path (raider attacks, defender attacks, vanguard attacks all flow through here). `applyDamage` now takes `state` as its first arg so it can access `state.factions` for the decrement.
- New end-of-step pass `recomputeSupplyCaps(state)` derives `supplyCap = SUPPLY_CAP_INITIAL + bonus × count(operational alive supply structures)`. Doing it once per step (not on each Pylon-state-change) is cheaper than tracking transitions, and keeps the rule in one readable place. Pylons become operational when `buildTicksRemaining` hits 0; the recompute on the same tick picks them up so next tick's commands can use the new cap.
- `Sim.stateHash()` extends FactionState slot with `supplyCap + supplyUsed` (both u32); `structureKindToInt` adds `supply=2`; `hashStructure` handles the supply variant (build-phase only field). `REPLAY_VERSION` bumps to 7.
- AI: new Pylon trigger fires when `supplyUsed >= supplyCap - 2`, energy + colour cover the build cost, AND no Pylon is already in progress (`hasPylonInProgress` helper). Without the in-progress check the AI would queue a new Pylon every tick of the current build window, burning energy. `pickCombatTrainTarget` extends to require `supplyAvail >= supplyCost` per kind so the AI doesn't emit doomed `TrainAtStructure` commands at the cap.
- `main.ts` SPEC: split the lone central Flux node into two flank-symmetric Flux nodes at (9,16) and (22,16). Equidistant between HQs but on different diagonals — committing to one means defending it instead of splitting attention across both. Same shape as PRD §6.6's "geographically committal third base."
- UI: `BUILD PYLON` button on the buildables panel (75 E, +8 supply cap label). HUD per-faction line gains `s N/M`. Unit-train buttons disable with new `supply blocked` reason; reason ordering is no-forge → forge-busy → tier-2 → no-flux → no-colour → supply-blocked (most actionable first).
- Renderer: `buildPylonMesh` produces a short truncated-cone base + a glowing faction-coloured cap. Visually distinct from the Forge (boxy) and Spire (tall finial) so two or three Pylons in the home patch don't crowd the silhouette. Same build-progress fade. `SimRenderer.syncStructures` extends to dispatch on the supply kind. `InputController` extends `pendingPlacement` to include `'supply'` + adds `enterPlacePylonMode()`.

**Gates added:**
- 5 new sim tests in `training.test.ts` (Phase 3.6 block): SpawnUnit increments + applyDamage decrements supplyUsed (worker killed by raider scenario); TrainUnit at HQ silently rejected at cap; TrainAtStructure silently rejected with reservation semantics (queue-time bump); building a Pylon raises supplyCap by 8 once operational; killing a Pylon drops the cap (alive units stay alive even when used > cap).
- All 151 unit tests pass after `RECORD_GOLDEN=1` regenerated the four golden fixtures (sim hash format moved with FactionState's new supply slots + new structure-kind discriminator).
- All 9 Playwright e2e gates green against the new sim. Production `npm run build` clean.

**Lessons:**
- The reservation-at-queue-time decision was the load-bearing call. The naive port — "check supplyAvail at queue time, bump supplyUsed at spawn time" — has a race: with two Forges the player could queue Vanguard A (passes check, used unchanged) and Vanguard B in the same tick (still passes the same check). When both spawn, supplyUsed exceeds the cap. Reserve-at-queue closes the race because the second TrainAtStructure sees the freshly-bumped supplyUsed. The trade-off: spawn-from-completion in advanceStructure must NOT bump (already reserved). That's a coupling between two files; comments + tests pin it down.
- The "centralised increment in spawnUnit" instinct was the wrong shape for supply. Pre-3.6, `spawnUnit` was the single chokepoint for unit creation — natural place to centralise side effects. But supply is a queue-time concern, not a spawn-time concern, so the chokepoint moved out to the callers. The lesson: not every cross-cutting concern belongs at the same layer. Cost deduction lives at `applyCommand` (queue-time, before any timer starts); supply reservation is the same shape as cost deduction; both are queue-time, not spawn-time.
- The end-of-step `recomputeSupplyCaps` pass was the right call over per-event tracking. Per-event would mean: bump cap on Pylon-becomes-operational (advanceStructure's transition from buildTicksRemaining=1→0); decrement cap on Pylon-dies (applyDamage on a structure, which doesn't currently exist as a chokepoint — the raider's attack path inlines the kill). Wiring all those transitions correctly is fragile; a single end-of-step linear scan over a handful of structures is fast and bit-stable. The hash captures the cap directly so cross-OS determinism works without re-deriving from operational-pylon count on each peer.
- "Existing units are not retroactively killed when supply drops" was a deliberate UX call. The alternative — kill the lowest-priority unit when cap drops below used — has been done in some RTSes but it's a feel-bad mechanic (the player loses agency over which unit dies). The "you can stay over-cap, just can't train new" rule is what most modern RTS go with and is what playtesters intuit. Sim-side it's also simpler: no eviction order to define, no determinism risk from "which unit dies first."
- Splitting the central Flux into two flank-symmetric Fluxes was a tiny change with disproportionate macro impact. With one central Flux, every match collapsed into the same midpoint scrum. With two flanks, taking one is a real commitment — the opponent can punish by going for the other side or by raiding your home patch. Same lesson PRD §6.6 makes about "geographically committal third bases": map *shape* drives strategic *variety*, separate from unit balance.
- The "snapshot the buildTicksRemaining bound before the wait loop" trap caught me again in the new Phase 3.6 tests — same trap the comment at line 192 of `training.test.ts` warned about. Reused the snapshot pattern in three places. Lesson: when writing the next test that waits on a counter that the loop body decrements, snapshot the bound first; it's not a JavaScript quirk worth re-discovering each time.

### 3.7 — Worker energy dump + fading light trail + tech-upgradeable duration ✅ closed

Tron-flavored defensive micro for workers; faction-defining flavor for the cyan side (locks in as Pulse-faction-specific in 3.9). The mechanic: a worker under threat dumps stored Energy as a deadly light trail; the attacker either veers around (loses time) or drives through (dies). Substantial Energy cost prevents spam. Trail segments fade visually toward the tail, and the trail's effective duration can be extended via a research upgrade at the Spire.

**Exit:** player can activate dump on a worker mid-flee; an enemy raider that walks into the trail dies; cooldown + Energy cost prevent spam; researching the duration upgrade visibly extends how long the trail persists. ✅

**What landed:**
- New `Trail { id, alive, ownerFaction, segments: Array<{x, y, age}> }` entity in `types.ts`. Lives in `SimState.trails`. Same array-with-tombstones discipline as units / structures so iteration order is bit-stable across the hash.
- `Worker` gains `dumpTicksRemaining + dumpCooldownTicks + activeTrailId` (3 numeric fields). All three reset to 0 on death (canonical hash form, same shape as `carriedKind = 'energy'` reset).
- `FactionState.trailDurationResearched: boolean`. `UpgradeStructure.researchKind: 'tier2' | 'trailDuration' | null` so the same research slot can host either research; `null` when idle, set when a research command fires, cleared back to `null` on completion. `ResearchTier2AtStructure` was extended to set `researchKind = 'tier2'` (back-compat — same observable behaviour).
- `units-config.ts` constants: `DUMP_ENERGY_COST = 100`, `DUMP_DURATION_TICKS = 40` (2 s), `DUMP_COOLDOWN_TICKS = 200` (10 s), `DUMP_SPEED_MULTIPLIER = 2`, `TRAIL_SEGMENT_LIFETIME = 60` (3 s), `TRAIL_KILL_RANGE_SQ = rangeSq(0.4)`, `TRAIL_DURATION_FLUX_COST = 40`, `TRAIL_DURATION_RESEARCH_TICKS = 80`. All placeholder; tuned in 3.12.
- New commands: `ActivateEnergyDump = 9` (`{ workerId }`) and `ResearchTrailDurationAtStructure = 10` (`{ structureId }`). Sim-side gates: dump rejects if worker dead / not a worker / already dumping / on cooldown / faction underfunded; research rejects if structure not an alive operational Spire / busy / faction already researched / underfunded.
- `step.applyCommand` for `ActivateEnergyDump`: deducts cost, spawns a fresh Trail entity, sets `activeTrailId + dumpTicksRemaining`. Cooldown counter starts at dump-end (not dump-start) so the player gets the full cooldown after the ability finishes — `dumpCooldownTicks` stays at 0 at activation and is set to `DUMP_COOLDOWN_TICKS` only when `dumpTicksRemaining` hits 0.
- `advanceWorker` refactored: a wrapper computes `dumping` once at the top, calls `advanceWorkerPhase(state, w, dumping)`, then runs post-step bookkeeping (append segment at post-move position, decrement counters, transition to cooldown on dump-end). The phase function takes a single `speed` value (`baseSpeed × DUMP_SPEED_MULTIPLIER` while dumping) and threads it through every movement path. Harvest cadence is unchanged (time-gated, not speed-gated).
- New `advanceTrails` step pass: ages segments by 1, drops expired ones, kills empty trails. Effective lifetime is looked up at expiry time (not at segment-spawn time) so an in-flight trail extends the moment the trail-duration research lands.
- New `trailKillSweep` step pass: O(units × trails × segments) collision check. Any alive non-owner unit overlapping any segment within `TRAIL_KILL_RANGE_SQ` dies (calls `applyDamage(state, u, u.hp)` so the unit's death flows through the existing supply-decrement + worker-cleanup chain). Owner gets the kill credited via `awardKill`. Structures + HQs are immune (only Unit kinds participate).
- Step ordering: `commands → units → trail-kill-sweep → advanceTrails → advanceNode → advanceStructure → recomputeSupplyCaps → win-check → bump tick`. Trail kill runs BEFORE trail age so freshly-laid segments (age=0) and about-to-expire segments both have one chance to kill on this tick.
- `Sim.stateHash()`: extends FactionState slot with `trailDurationResearched`; extends Worker slot with `dumpTicksRemaining + dumpCooldownTicks + activeTrailId`; extends UpgradeStructure slot with `researchKind` (encoded `0=null, 1=tier2, 2=trailDuration`); appends a new dynamic-length section for `state.trails` (count + per-trail `id/alive/owner/segments-count + per-segment x/y/age`). `REPLAY_VERSION` bumps to 7 → 8.
- UI: `BuildablesPanel` adds two buttons — `TRAIL+` (research at Spire, gated like TIER 2) and `DUMP (E)` (one-shot ability for selected workers; enabled when at least one selected unit is a player-owned alive worker not currently dumping or on cooldown, AND faction has the energy). `BuildablesPanel.refresh` now takes the selected-unit-ID set so the DUMP button can be enable-aware. `InputController` adds `dumpSelectedWorkers()` (fans out one `ActivateEnergyDump` per dumpable selected worker) + `researchTrailDuration()`. Hotkey `E` triggers dump.
- Renderer: `buildTrailSegmentMesh(faction, x, y)` produces a small flat glowing tile (32 × 6 × 32 cm) in the faction's emissive colour. Per-segment material is unique so opacity + emissive intensity fade with age. `SimRenderer.syncTrails()` runs each frame: per alive trail, maintain a `THREE.Group`, rebuild segment children from the current `trail.segments` array, and apply the age-based fade. Dead trails (or trails not in sim) are torn down with proper geometry/material disposal. The per-frame rebuild is wasteful for many segments but max scale is ~40 segments × handful of trails — well within budget. `InstancedMesh` is the upgrade path if trail counts grow.

**Gates added:**
- 6 new sim tests in `training.test.ts` (Phase 3.7 block): ActivateEnergyDump deducts energy + sets dump fields + spawns trail; rejected on insufficient energy / already-dumping / on-cooldown; dumping worker moves measurably faster than a non-dumping worker on the same path; trail kills enemy unit but spares same-faction units (sacrificial enemy worker scenario — workers don't attack so combat doesn't entangle the test); segments age out and the trail dies; ResearchTrailDuration via Spire flips the faction flag, and a subsequent dump's trail outlives the base lifetime.
- All 157 unit tests pass after `RECORD_GOLDEN=1` regenerated the four golden fixtures (sim hash format moved with FactionState's new flag + Worker's new fields + UpgradeStructure's new researchKind discriminator + the new state.trails section).
- All 9 Playwright e2e gates green against the new sim. Production `npm run build` clean.

**Lessons:**
- "Look up effective lifetime at expiry-time, not at spawn-time" was the right semantic call. The naive port — stamp each segment with the lifetime ceiling at spawn — would mean a trail laid before research completes still expires at the base rate, which feels wrong for an "extends my trails" research. Looking up the flag at expiry-time gives the player the immediate-feedback buff they expect: research completes mid-trail, segments visibly hang around longer. Cost: one extra branch per segment per tick (negligible).
- Wrapping `advanceWorker` rather than threading `dumping` through every phase case kept the diff small. The earlier instinct — touch each phase individually to handle dump-related logic inline — would have ballooned the function and missed phases. The wrap-then-dispatch pattern lets every existing phase keep its early-return shape; the dump bookkeeping fires after the phase function regardless of which path it took.
- The trail-collision test took two iterations because using a raider as the "victim" entangled the test with the raider's combat targeting (the raider engages the worker BEFORE walking through the trail, kills the worker, the trail-kill assertion fails). Switching to an enemy worker as the sacrificial unit collapses the scenario into pure trail-overlap behaviour. Lesson: when designing a sim test for one mechanic, pick the simplest entity that exercises it; combat-capable test subjects pull in unrelated mechanics.
- The DUMP button's text contained "worker leaves trail" which broke the existing `getByRole('button', { name: /worker/i })` Playwright selector in `tests/e2e/mouse.spec.ts` — the regex matched the DUMP button's accessible name. Fix was to rename the button subtitle ("leaves deadly trail"). Lesson: when adding new buttons, audit existing test selectors for accidental cross-matches; a tightly-scoped selector regex is also a defensive posture (`name: /^worker$/i` would have been immune).
- `tileToWorld` from `legacy/grid` asserts integer tile coords + in-bounds. Trail segments live at fractional sim positions (the worker's tile-float position when the segment was laid), so the renderer needed an inline float-aware version of the offset math. Same shape as `tileFloatToWorld` from `scene.ts` — a candidate for consolidation in a future cleanup but not load-bearing now.
- The "trail-kill before trail-age" ordering was deliberate: a freshly-laid segment (age=0) gets one chance to kill on the tick it was laid; an about-to-expire segment gets one final chance to kill on the tick it expires. The reverse ordering (age-then-kill) would mean the just-laid segment ages to 1 immediately, indistinguishable from older segments — fine for the hash but loses the "instant lethality of fresh segment" feel. Tuning detail; documented inline in `step.ts` so a future contributor doesn't flip the order without realising.
- Per-frame trail mesh rebuild (rather than per-segment add/remove diffing) was the right call given the small numbers and the need to fade by age. The diff approach would have required tracking segment identity (which doesn't exist — segments are POJOs with no ID) plus material updates per segment. Full rebuild is O(segments) per frame per trail; max scale is ~200 segments total under playtest. Fine. If trail counts blow up in 3.9+ asymmetric Pulse content, switch to InstancedMesh — same shape as the supply-cap recompute trade-off in 3.6.

### 3.8 — Fog of war + worker resource discovery (scouting) ✅ closed

Two coupled mechanics in one sub-phase: per-faction vision filtering on the renderer, and per-faction resource discovery. They couple because scouting only makes sense if there's something hidden to scout for.

**Exit:** a faction starts with home-patch node knowledge only; sending a worker out scouts farther nodes; once discovered, a node stays discovered (and remains drawn even outside current vision); enemies discovered by passing through a unit's LOS are visible; the desync gate from 2.3 still fires (vision + discovery are per-faction views over canonical sim state). ✅

**What landed:**
- `ResourceNode.discoveredBy: [boolean, boolean]` — per-faction permanent flag. Set true the first time any of the faction's units / structures comes within visionRadius; never cleared. Hashed unconditionally.
- `UnitStats.visionRadius` (worker 4, defender 5, raider 5, vanguard 6); `StructureStats.visionRadius` (Forge 6, Spire 6, Pylon 5); `HQ_VISION_RADIUS = 8` (separate const because HQ doesn't have a `StructureStats` row).
- New `step.advanceDiscovery(state)` pass: iterate friendly units + structures + HQ, mark every undiscovered node within vision radius as `discoveredBy[faction] = true`. Short-circuits on already-known nodes so the cost dominates the early-game then drops to near-zero.
- `state.createInitialState` runs `initialHqDiscovery` so home-base nodes inside HQ vision are pre-discovered at tick 0. Without this the AI deadlocks (no nodes discovered → autoAssign emits no commands → workers don't move → no discovery), and the player would stare at an empty map on match start. Cheap (8-tile radius × ~10 nodes); fires once.
- Sim hash extends `ResourceNode` slot with `discoveredBy[0] + discoveredBy[1]` u32 each. `REPLAY_VERSION` bumps to 8 → 9.
- AI's three node-finder helpers (`nearestHarvestableNode`, `nearestLiveNodeOfKind`, `nearestLiveNodeOfKindWithReserve`) all gained a discovery filter — undiscovered nodes are skipped. The flux + colour bias helpers gained a `faction` parameter (previously kind-only) so the discovery check has a faction context.
- Renderer (`SimRenderer`) gains `playerFaction` (was `_playerFaction` reserved for this sub-phase) + a `bypassVision: boolean` constructor flag (true for observer mode). Each frame, `collectVisionSources()` rebuilds a small list of friendly vision sources (HQ + units + structures with their squared radii); `isPositionVisible(x, y)` is a linear scan against that list. `syncHqs / syncUnits / syncStructures` set `mesh.visible = false` for enemy entities outside the bubble; `syncNodes` sets `visible = false` for nodes not in `discoveredBy[playerFaction]`. The mesh is built lazily either way so transitions on first discovery are a `visible = true` toggle, no scene-graph reshuffle.
- `InputController.pickLiveNode` already iterates `nodeMeshes.values()` filtering on `g.visible`, so the renderer's visibility gate doubles as the click-to-assign gate — no separate input-layer code needed. Same for `pickOwnedUnit` (which only ever returned own units anyway).
- `main.ts` passes `isObserver` as `bypassVision` so the spectator view sees both factions' state.
- The sim itself does NOT reject `AssignWorkerToNode` against undiscovered nodes — discovery is a presentation + AI concern. A scripted match / replay / debug tool can still target any node; the sim accepts. Documented in a test (Phase 3.8 block, "AssignWorkerToNode is NOT gated on discovery").

**Gates added:**
- 4 new sim tests in `training.test.ts` (Phase 3.8 block): nodes within HQ vision are pre-discovered at tick 0; nodes outside are not; walking a worker into vision range flips the discovery flag; AI's `autoAssignIdleWorkers` returns no commands when the only node is undiscovered; the sim's `AssignWorkerToNode` accepts undiscovered targets (presentation-layer gate, not sim-layer).
- All 161 unit tests pass after `RECORD_GOLDEN=1` regenerated the four golden fixtures (the hash format moved with the new per-node discovery bits + the per-tick discovery sweep).
- All 9 Playwright e2e gates green against the new sim. `AI_VS_AI_SPEC` already places its colour nodes within HQ vision so AI bootstrap continues to work post-discovery.

**Lessons:**
- The bootstrap-deadlock risk was real and cheap to defuse. With strict "all nodes start undiscovered," the AI emits no auto-assign commands, no workers move, no discovery happens — the match degenerates into stationary bases for 3000 ticks. Pre-discovering nodes within HQ vision (`initialHqDiscovery` runs once in `createInitialState`) is the natural fix that also matches the player's intuition: "I should see my own home patch." Lesson: when adding a fog-of-war system, audit the bootstrap path explicitly — the entity that produces vision is the same entity that needs vision to act.
- "Discovery is a presentation + AI concern, not a sim-rule" was a deliberate design call. The alternative — gate `AssignWorkerToNode` on `discoveredBy[faction]` — would have been one more silent-reject in `applyCommand` and would have looked symmetric with the colour-faction gate from 3.5. The asymmetry is intentional: colour-locking is a *gameplay rule* (you can't harvest the wrong colour, ever), while discovery is a *fog-of-war abstraction* (you don't know about it until you see it; once you do, you can act). Encoding fog at the sim level would couple the canonical state to a UX concept; keeping it at the renderer/AI level lets debug tooling, replays, and scripted matches address any node by ID. Documented inline.
- Renderer per-frame `collectVisionSources()` was the right shape over precomputing per-tile bitmaps. Friendly entity counts are small (~30 max in the late game); per-frame cost is dwarfed by mesh updates anyway. The bitmap approach would have meant 32×32 = 1024 bits per faction recomputed per tick, plus a second per-tile lookup at draw time — fine but heavier than the current ~30-source loop.
- The visibility gate at `mesh.visible = false` doubles for input-pick filtering for free because `InputController.pickLiveNode` was already filtering on `g.visible`. Same for unit picks. Cheap composition: one renderer concern (don't draw what the player can't see) handles two surface concerns (don't draw it, don't let them click it).
- Vision radii numbers are placeholder; 3.12 will tune. The shape that's load-bearing is "structures see further than units, HQ sees furthest, vanguard outscouts raider." If playtest says "raiders should be the scouts," swap two numbers — the rest of the system is parametric.
- `SimRenderer`'s constructor went from `_playerFaction` (deliberately unused) to `playerFaction` (used). The `void _playerFaction` line that survived 3.0–3.7 was a marker for "this is what we'll use when fog lands." Same pattern is worth using in future sub-phases when reserving fields ahead of the work that consumes them.

### 3.9 — Game feel & presentation pass

The mechanics surface from 3.0–3.8 produces a complete RTS loop, but match *feel* hasn't been touched since Phase 1. Symptoms a first-time player notices in the first minute: units read tiny against the 32×32 grid; every structure is a single-cell box (HQ, Forge, Spire, Pylon all the same footprint, only silhouette varies); fog of war is invisible (enemies "pop in" rather than emerging from a visible fog edge — sim-correct since 3.8 but the renderer makes no attempt to show the boundary); workers auto-assign to nodes the moment they spawn (player has no agency on creation); right-click move and left-click action both land without any visual or audio confirmation; no animations beyond positional lerp; no sounds; no main menu — the build drops the player straight into a match.

This sub-phase is **presentation, not mechanics**. The sim is largely untouched (so `REPLAY_VERSION` stays at 9 and the cross-OS gate stays green throughout), with two small, surgical sim-shape additions called out below. Item ordering is fun-per-effort, highest first.

1. **Input feedback layer.** Move-order ping at the right-click target tile (short fade), attack-confirm flash on left-click, distinct cursor states (default / select / move / attack / place), drag-rect chrome (currently an undecorated overlay div from 3.3). All renderer.
2. **Unit agency on spawn.** Strip `autoAssignIdleWorkers` from the default behaviour for player factions — new units stand still until commanded. Add per-structure rally points (the queue from 3.0 already supports a single train slot; rally is a tile target consulted on spawn). Sim change: an optional `rally: { x, y } | null` slot on production structures + HQ; AI keeps its current auto-assign loop. The `autoAssignIdleWorkers` *call site* moves out of the player path; the function itself stays — AI still uses it, scripted matches still use it.
3. **Visual scale + silhouette pass.** Larger unit meshes (current scale reads as ant-sized vs structures); multi-cell footprints for HQ (3×3), Forge (2×2), Spire (2×2), Pylon (1×1 stays). Sim change: `tileFootprint: { w: number; h: number }` on `StructureStats`; placement validation, vision-source positions, and pathing/collision all read it instead of assuming 1×1. This is the load-bearing sim shape change of the sub-phase — bumps `REPLAY_VERSION` to 10 and regenerates golden fixtures.
4. **Fog visualization.** Actual dark overlay outside vision sources, soft edge gradient, "explored but not visible" mid-tone for terrain (per-faction explored-tiles bitmap on the renderer side — sim doesn't need to know), reveal-pulse when an enemy first enters LOS. Renderer-only; sim already provides the data from 3.8.
5. **Audio layer (minimal).** UI click, train-complete, attack-hit, alert-on-base-attacked, build-complete, ambient grid hum. New `src/audio/` module gated by a mute toggle in the HUD. Six sounds is enough to triple perceived production value; more is Phase 4 polish.
6. **Unit animation pass.** Idle pulse, walk bob, attack flash, death dissolve. Sim states already exist (worker phase, raider attack cooldown, alive/dead); renderer just reads them. No sim shape change.
7. **Main menu + match chrome.** Menu scene (PLAY VS AI / MULTIPLAYER / OPTIONS), faction picker placeholder (locked to Pulse until 3.10 lands), settings panel (volume, key-binding stub for §3.8), redesigned VICTORY/DEFEAT overlay with replay download + return-to-menu. New `src/render/menu/` directory; `main.ts` learns a menu mode that precedes the match scene.

Each item lands as its own commit on `main`; all close together as 3.9 once the gate runs green. Items 1–4 are the highest leverage — they fix the "this doesn't feel like a game" complaint directly. Items 5–7 can slip into 4.x polish if Phase 3 timeline tightens; 7 in particular overlaps with Phase 4's Steam-wrapper work and could move there cleanly.

**Sim-shape impact:** small but real — `tileFootprint` on `StructureStats` (item 3) and an optional `rally` field on production structures + HQ (item 2). `REPLAY_VERSION` bumps to 10 once item 3 lands. Everything else (audio, animations, menu, fog overlay, input feedback) is renderer-only.

**Exit:** a first-time player can launch the build, see a menu, start a match, train units that wait for orders, give those units commands with visible *and* audible feedback, see the enemy emerge from a visible fog edge instead of popping in, and finish the match wanting to play another. Cross-OS determinism gate green against the new sim shape; all Phase 2 e2e gates still pass.

**What landed:**
- **3.9.1 Input feedback layer** — new `src/render/feedback.ts` (`FeedbackOverlay`) with three cue types: faction-coloured **move ping** at right-click target, green **assign pulse** when workers are routed to a node, neutral **placement burst** when a structure is placed. `input-controller.ts` fires hooks on commit + sets canvas cursor (`crosshair` in placement, `pointer` over own unit / live node, `auto` otherwise). Per-frame ring scaling + quadratic alpha falloff via the existing `eventPulseFactor` curve. Renderer-only.
- **3.9.2 Unit agency on spawn** — stripped `autoAssignIdleWorkers` from both player paths in `main.ts` (PvAI commands callback + lockstep `collectLocalCommands`). Newly trained workers + workers that just deposited stand idle until commanded. `tickAi` still calls the helper internally for its own faction. Sim untouched. PRD §6.3 ("assignment matters and idle workers are a real problem") direction made literal.
- **3.9.3 Visual scale** — `meshes.ts` scale constants: units 1.8×, HQ 2.0×, Forge 1.9×, Spire 1.4×, Pylon 1.4×; vanguard inherits raider × 1.5 × UNIT_SCALE. `ai.ts` Forge offset bumped from (±2,±2) to (±3,±3) and Spire from (±1,0) to (±3,0) so the bigger silhouettes don't visually overlap the HQ. No `tileFootprint` field on `StructureStats` (deferred — would only earn its keep when sim consumes it for placement validation / vision center / pathing, none of which land here). Sim untouched. AI scripted match never reaches the Forge-build branch in 3000 ticks (lean energy budget), so golden fixtures didn't move.
- **3.9.4 Fog of war (v4 metaphor)** — first three implementation attempts failed for instructive reasons documented inline in `fog-overlay.ts`. v4 lands the Tron-correct **uncover-as-explore** metaphor: dark layer covers the grid by default; visible tiles drop the layer to transparent so the brightened grid lines (`grid.ts` divider intensity bumped 0.4 → 1.2 in the same sub-phase) shine through. Composited per-pixel CPU-side via `min()` of falloff contributions — single mesh, single texture, NormalBlending, no GPU blend shenanigans, no shader. `grid.test.ts` upper-bound widened to match. Renderer-only; explored bitmap lives outside sim state.
- **3.9.5 Audio** — new `src/audio/audio-manager.ts` (`AudioManager`, Web Audio API, lazy context under user gesture, fail-soft if WebAudio unavailable) + new `src/render/event-detector.ts` (`GameEventDetector`, snapshots sim state, fires cues on tick advance). Five cues: UI click (panel buttons), train complete (rising chime), build complete (double tick), attack hit (noise burst), HQ alert (pulsing low tone). Throttled at most one per type per tick. Mute toggle on **M** with HUD indicator top-right. No external assets — every sound is an oscillator + envelope. Renderer-only.
- **3.9.6 Unit animations** — extended `UnitVisual` interface to surface the legacy mesh code's `triggerPlacementPulse`, `triggerDeathPulse`, `tickPlacementPulse`, `tickDeathPulse`. `sim-renderer.ts` triggers placement pulse on lazy mesh creation (a unit ID seen for the first time = newly trained), and on alive→dead transition moves the visual into a `dyingUnits` pool that holds the mesh visible until `tickDeathPulse` returns false. Wall-clock dt tracked internally so animation rate is render-rate, not tick-rate. Sim untouched.
- **3.9.7 Main menu** — new `src/render/menu/main-menu.ts` (`MainMenu`, pure DOM). PvAI mode opens to a Tron-styled menu (glowing cyan VYLUX title + PLAY VS AI / MULTIPLAYER stub / OPTIONS stub + faction-locked Pulse note). `main.ts` awaits the play click before the scene + match are built. Lockstep / observer URL flows skip the menu (intent already encoded). `?menu=skip` URL param bypasses the menu — used by e2e tests + future deep-link share flows. Match-end RELOAD button returns to the menu naturally on reload.

**Gates added:**
- No new Vitest tests (the entire sub-phase was renderer + audio + DOM, not sim shape). `grid.test.ts` upper bound on `dividerEmissiveIntensity` widened from 0.5 → 2.0 to accommodate the 0.4 → 1.2 bump.
- No new Playwright assertions, but two debug spec files added during iteration: `tests/e2e/fog-debug.spec.ts` and `tests/e2e/menu-debug.spec.ts`. Both are visual-review aids (screenshot the canvas at known time points) — kept for the duration of 3.9, dropped at close.
- Three existing e2e tests updated to use `?menu=skip` so they still hit the match scene directly: `smoke.spec.ts`, `mouse.spec.ts`, `select.spec.ts`, plus the fog-debug spec.
- All 161 unit tests + 10 e2e gates green.

**Lessons:**
- **Self-verify visual changes.** The fog work iterated four times — the first three were wrong (Fixed/float bug, then wrong metaphor, then `MaxEquation` ignoring blend factors). I burned the owner's time as the visual QA loop because I had no way to see what I was rendering. Setting up `fog-debug.spec.ts` (Playwright + screenshot) collapsed the iteration loop from 5+ minutes per round to <30 seconds and let me catch the v3 brightness issue myself before pushing back to the owner. **For any visual work after this, build the screenshot harness first.**
- **MaxEquation per WebGL spec ignores blend factors.** Tried `MaxEquation` + `SrcAlphaFactor` to cap stacking on overlapping vision pools; the gradient texture's alpha was therefore never attenuating fragment RGB and the gradient collapsed into a hard saturated disc. Fix was to drop the GPU multi-mesh approach entirely and composite on the CPU via per-pixel `min()`. Lesson: GPU blend equations have spec quirks that aren't visible in the API surface — when blending behaviour seems wrong, read the underlying WebGL extension spec, not just the Three.js wrapper.
- **The metaphor matters more than the visual fidelity.** v3 fog (vision adds light to the grid) had perfect math but the wrong concept — the owner immediately saw it as backwards: "we're adding glow as we explore instead of uncovering map." v4 inverted the painter (dark by default, transparent in vision) and required bumping the base grid intensity 0.4 → 1.2 so there was something to uncover. Same data, opposite framing, completely different read. **Pick the metaphor before tuning the numbers.**
- **`autoAssignIdleWorkers` was masking the idle-worker problem the PRD calls out.** Removing it from the player path made workers feel "agent-controlled by me" instead of "auto-managed for me," which is the PRD §6.3 + §3.8 direction made literal. The change is one line in `main.ts` × two callsites. Big behavioural shift from a tiny diff.
- **WebAudio's lazy-on-gesture quirk is well-handled by deferring context creation.** `AudioManager.ensureContext()` constructs the context on first call (which is always inside a click event handler), so no special unlock flow is needed. The fail-soft pattern (return null on browser refusal) means a sandboxed test environment gets silence, not crashes.
- **The legacy mesh code already had placement + death pulse APIs from Phase 1**, just unused since the sim-renderer rewrite stopped calling them. Surfacing them through `UnitVisual` cost ~25 lines and unlocked spawn/death animation immediately. **Audit legacy code for unwired capability before writing new visual code.**
- **`?menu=skip` URL flag is the right tool for "make tests bypass UI flows that don't exist in the path under test."** Cleaner than text-selector clicks (which couple tests to button copy) and explicit about intent. Same shape as `?desync-test=N` from 2.3 and `?lockstep=host` from 2.0.

### 3.10 — In-game HUD / action-bar redesign (context-sensitive)

The Phase 1 buildables panel was a flat always-on grid of every action the player can possibly take — TRAIN WORKER / DEFENDER / RAIDER / VANGUARD, BUILD FORGE / SPIRE / PYLON, RESEARCH TIER 2 / TRAIL+, DUMP. Each cell is a small bordered card with a title and a one-line cost / reason note. After 3.0–3.8 grew the catalog, the panel reads as **a wall of cards of information** rather than a guided action bar — the player sees ten "things" without any visual cue about which one is the natural next move, and grey-out reasons (`no forge` / `tier 2 not researched`) explain failure but not purpose.

3.10 reframes the panel as a **context-sensitive action bar** driven by selection — the standard RTS pattern (StarCraft, AoE, Warcraft III). The actions you see are the ones the *thing you have selected* can do, not every action that exists in the game.

**Selection → actions:**

- **HQ selected** — TRAIN WORKER. (HQ is workers-only since 3.0.)
- **Worker selected** — BUILD FORGE / SPIRE / PYLON, DUMP (E). Workers are the builders.
- **Forge selected** — TRAIN DEFENDER / RAIDER / VANGUARD (vanguard greys out until tier 2 researched, but stays *visible* with a tooltip / icon explaining the lock).
- **Spire selected** — RESEARCH TIER 2 / RESEARCH TRAIL+. (Both research slots live on the Spire per 3.2 + 3.7.)
- **Pylon selected** — info-only (no actions). Confirms supply contribution.
- **Multiple unit kinds selected** — only the union of *commands* (move, stop), not training. (Future: production-from-anywhere when control groups land in Phase 4.)
- **Nothing selected** — empty action bar with a one-line hint ("select your HQ to train workers").

**Visual upgrade:**

- Bigger button slots that read as buttons, not cards. Clear hover state with faction-glow ring.
- Each action gets a small **icon / silhouette** so the player can recognise it at a glance instead of reading the label every time. Upgrades especially need this — RESEARCH TIER 2 and TRAIL+ are currently indistinguishable squares of text.
- Hotkey letters surfaced on each button (matches the §3.8 mechanical-mastery direction without committing the full key-bind UI yet).
- Cost display gets a clear iconography (E / F / C glyphs in faction colours) instead of the current `e ##` / `f ##` text.
- Disabled reason becomes a tooltip on hover, not a permanent line of greyed text — keeps the bar visually clean.

**Sim-shape impact:** none. The actions are the same `TrainUnit` / `TrainAtStructure` / `BuildStructure` / `ResearchTier2AtStructure` / `ResearchTrailDurationAtStructure` / `ActivateEnergyDump` commands that already exist; only the UI affordance changes. `REPLAY_VERSION` stays at 9. No fixture regeneration needed.

**Open scope decision:** how does the *first* Forge get built? Today the panel offers BUILD FORGE without requiring a worker selection. Routing buildings through worker-selected → BUILD changes the bootstrap flow (the player must train a worker first, then select it to build). That's the SC2 / AoE pattern and matches PRD §6.3 ("workers gather, deposit, **and repair**" — and by extension build). The alternative (HQ selected → BUILD options) is the AoE 4 / Anno pattern. Pick the worker-builder pattern unless playtest pushes back; documented in the closing notes.

**Exit:** selecting an HQ shows only TRAIN WORKER; selecting a worker shows BUILD options + DUMP; selecting a Forge shows combat training; selecting a Spire shows research. The action bar is empty when nothing is selected. Disabled actions still show but explain why on hover. The player can complete a full match (train workers → build Forge → train raider → win) using the new bar.

### 3.11 — Enemy AI faction(s) with distinct rosters _(repointed PvE)_

> **Repointed 2026-05-07.** The pre-pivot version of 3.11 (under v4) was "two playable factions, both balanced for 1v1 ladder play." Post-pivot, the player faction is *the* faction (kept as-is from 3.0–3.10's catalog), and **3.11 builds the enemy AI faction(s) that the player fights against in PvE**. The asymmetry now means "the enemy plays differently from the player," not "two playable factions are balanced against each other."

Build at least one (target two) **enemy AI factions** with distinct rosters and threat profiles. The player keeps the current faction-0 catalog (worker / defender / raider / vanguard / Forge / Spire / Pylon); enemy factions get unit kinds the player doesn't have, or stat-curve variants of existing kinds, plus distinct AI behaviour patterns.

Working naming + shape:
- **Pulse swarm** — fast, fragile, many. Threat profile: overwhelm with raider-equivalents, punish a player who built only frontline. Distinct unit: lightweight raider variant (faster, lower HP).
- **Forge siege** — slow, heavy, few. Threat profile: walks at HQ slowly but each unit is hard to kill, punishes a player who built only harass. Distinct unit: tier-2 siege analogue.

Both enemy factions reuse the existing `FactionState` shape — the asymmetry lives in `units-config.ts` (per-kind stats), `ai.ts` (behaviour patterns), and a new `factionId` discriminator on the AI's build-order picks. The energy-dump from 3.7 stays player-only for now (it's a player-faction identity mechanic); enemy factions get their own threat tools.

This sub-phase does **not** introduce wave scheduling — that's 3.13's deliverable. 3.11 builds the *adversary*; 3.13 builds *what the adversary does over the course of a run*.

**Exit:** at least one enemy AI faction plays end-to-end against the player on the current single-map skirmish; replays of player-vs-enemy-faction-A and (if landed) player-vs-enemy-faction-B both run deterministically; the two enemy factions feel distinguishable in playtest within the first 60 seconds.

### 3.12 — Scenarios as data + seedable runs _(repointed PvE)_

> **Repointed 2026-05-07.** Pre-pivot, this was "maps as data, 2–3 launch maps for the 1v1 matchup matrix." Post-pivot it's "**scenarios as data** — `(map_layout, starting_resources, enemy_faction, wave_schedule_stub, seed)` — and seed-driven per-run variation." Maps remain hand-tuned; runs vary via seed.

Scenarios move out of `main.ts`'s hardcoded `SPEC` into data files under `src/scenarios/` (or `src/maps/` if scenario + map are still 1:1 at this point — open call, decide in-flight). A scenario at this sub-phase is:

- **Map layout**: grid dimensions, terrain, HQ position(s), energy / flux / colour node positions, vision-blockers.
- **Starting resources** for the player and the enemy AI.
- **Enemy AI faction** assigned (drawn from 3.11's set).
- **Seed** for the run's PRNG (passed into `Sim` at construction; already supported by the sim).

Wave scheduling is a **stub** at this sub-phase — a placeholder field that 3.13 fleshes out. The point of 3.12 is *the data lift*, so 3.13 has somewhere to write the wave schedule.

Hand-tune 2–3 launch scenarios with distinct shapes (carries from the v4 plan):
- **Open arena** — symmetric, no choke. Tests army composition.
- **Bottleneck** — central choke. Frontline-favoured.
- **Three-flux** — three contested Flux nodes including a committal third base.

Scenario selection arrives via URL param (e.g. `?scenario=bottleneck&seed=12345`); a real scenario-pick UI is Phase 4. Per-run variation comes from the seed, not procedural map gen.

**Exit:** the current single hardcoded SPEC is gone from `main.ts`; ≥2 scenarios load from data; the same scenario + seed produces a bit-identical run twice (already true via determinism, but verified explicitly here); replays carry the scenario id + seed.

### 3.13 — PvE win conditions (survive-N-waves + scenario objective + resign)

> **Repointed 2026-05-07.** Pre-pivot, this was "military-elimination + dominance-tick + 25-min timer + resign" for competitive 1v1. Post-pivot, the **PvE win conditions** from PRD §6.7 land here.

Replace the current "100-point threshold or HQ destruction" with:

1. **Survive the scheduled waves.** A scenario defines a wave count (e.g. 8 on standard, 12 on hard) and a wave schedule (per-wave: spawn time, spawn direction, unit composition). Surviving the final wave wins the run. The **wave scheduler** is the new sim component this sub-phase builds — a deterministic state machine that consumes the scenario's wave list and pushes enemy units into the sim at the scheduled tick.
2. **Scenario objective** (optional per scenario): hold a specific node for N waves, escort a structure to a destination, destroy an enemy spawner. Encoded as data on the scenario; checked each tick by a new `checkScenarioObjective` step pass.
3. **Boss wave** (boss-scenarios only, stretch): final wave is a single high-HP enemy unit with a designed mechanic. May slip to Phase 5 if mechanic design takes more time than the sub-phase budget.
4. **Resign** as a first-class command (CommandKind slot 13 — next available after 3.10's slot 12). Replays save on resign.

Loss conditions: HQ destroyed → defeat (already wired); player has no production capacity and HQ is mid-attack → effectively defeat (same code path).

Drop:
- The 100-point threshold (was esport scaffolding).
- The 25-minute hard timer (was esport-anti-stalemate scaffolding; PvE has no stalemate concern).
- The dominance-tick mechanism (was esport positional-win path; PvE replaces with surviving the scheduled escalation).

**Exit:** all PvE win paths exercised in scripted scenarios — survive 8 waves on the open arena → win; lose HQ during wave 5 → defeat; resign command → defeat; (if landed) defeat boss → win. The wave-scheduler ticks deterministically; replays of survival + defeat both round-trip. The point-system code can be removed or marked dead.

### 3.14 — Run-loop playtest gate ("is the loop fun")

> **Repointed 2026-05-07.** Pre-pivot, this was "internal playtests show no obviously dominant strategy or faction at tester skill" — an *esport balance* gate. Post-pivot, it's a **run-loop fun gate** — the only gate that matters for a PvE indie game.

The actual exit criterion: a player who picks up the build cold, plays a 15-minute run, and clicks "new run" because the next seed sounds interesting. This is **not** a balance gate (PvE balance is a long tail through Phase 4 + 5, not a Phase 3 close item). It's a **does this loop make me want to play it again** gate.

Work in scope:
- **≥20 internal runs** across the 2–3 launch scenarios + both enemy AI factions + 2–3 difficulty seeds.
- **Per-run logging**: run length, win/loss, wave reached, dominant strategy, "did the player want to start another run" yes/no captured in a quick post-run note.
- **Tuning passes** on wave cadence, wave composition, starting resources — small numbers, not new mechanics.
- **No new features.** If a feature is missing for the loop to be fun, that surfaces as a Phase 4 input, not a 3.14 add.

**Exit:** ≥20 logged runs; ≥60% of runs end with the player wanting to start another; at least 2 distinct viable strategies emerge across the playtest set (e.g. "harass-rush enemy spawners" vs "turtle-and-tech to vanguard"). If the loop isn't fun at this gate, the PvE direction itself is in question — **don't paper over a bad fun-gate by moving to Phase 4 anyway**.

## Success criteria — Phase 3 exit gate

| # | Criterion |
|---|---|
| 1 | Two factions ship with meaningfully different macros (build orders, economy curves, win conditions) — PRD §3.6. |
| 2 | At least 2 launch maps (target 4–6 by Phase 4); each has identifiable terrain features (chokes, vision blockers, contested Flux). |
| 3 | Counter-triangle holds in playtest — no role universally dominates within tier. |
| 4 | Tech tiers gate strategic decisions — early aggression vs Flux expansion vs tier-2 are all viable openings. |
| 5 | Fog of war makes scouting a real action; renderer never leaks information the sim hasn't authorised. |
| 6 | Multiple victory paths exercised — military elimination + dominance both produce wins in playtest, neither dominates as the only path. |
| 7 | 25-minute hard timer never fires in a "stalemate-by-design" — the dominance-tick mechanism produces a winner before then in 90%+ of matches. |
| 8 | Cross-OS determinism gate (Phase 0's contract) stays green throughout, with regenerated golden fixtures for the new sim shape. |
| 9 | All Phase 2 gates (lockstep, desync detection, replay round-trip, observer) continue to work against the new sim shape. |

## Risks — ranked

1. **Scope blowout.** Phase 3 commits more surface than Phases 0–2 combined. The risk is shipping a half-implemented vision: structures with no fog, factions with no real differences, maps with no terrain features. Mitigation: sub-phases are sequenced fun-first, each closes with a working sim. If timeline slips, drop sub-phase 3.7 (still ship internally playable) before dropping 3.6 (still ship single-faction). Don't half-land any sub-phase.
2. **Asymmetry done badly.** "Two factions" is easy to write and hard to design — the trap is shipping reskins (PRD §3.6 forbids this). Mitigation: 3.4 should produce factions that play differently in their *opening 60 seconds*, not just different unit-stat tables. If by 3.4 close the difference is only numeric, reopen the design.
3. **Determinism regression during sim-shape churn.** Each sub-phase changes `SimState`. Cross-OS CI may red-flag intermittently because golden fixtures lag the latest sim. Mitigation: regenerate fixtures *only* at the end of each sub-phase (not mid-flight), accept that mid-sub-phase commits may fail the cross-OS check until the regenerate pass, and document the regenerate procedure in `AGENTS.md`.
4. **Fog of war leaks information.** PRD §3.7 caveat: the renderer is a snooping surface. If the sim sends faction-1 unit positions to faction-0's renderer, a modded client reads them. Mitigation: implement vision *in the data the renderer receives*, not just *what the renderer chooses to draw*. The `SimState` view passed to a renderer should be filtered. This is a real architectural constraint, not a polish item.
5. **Solo-dev throughput.** This is the longest sub-phase by raw scope. Mitigation: ruthless cuts. Tier 3 stays optional (PRD §6.4 already calls it a stretch). Tech objectives stay optional. Map count stays at 2–3 for Phase 3 close (4–6 is the Phase 4 launch number). The faction asymmetry has to land; the third tier of polish does not.
6. **Replay-format invalidation pain.** Bumping `REPLAY_VERSION` invalidates all earlier replays. Mitigation: the only replays we have are dev replays, not user-facing artifacts. Phase 2.6 telemetry (parked) hasn't started, so no in-the-wild replays exist. The cost is the regenerated golden fixtures, paid once.

## Open questions (settled during, not before)

- **One Flux node or many?** PRD §6.3 says "scarce and contested" — a single map-centre Flux is the simplest read. Two Flux at flank-symmetry positions plays differently. Resolves in 3.5 with map design + playtest.
- **How long does a tier-2 research take?** Long enough that an early aggression can punish a teching player, short enough that "tech is dead" isn't the conclusion. Resolves in 3.2 with playtest.
- **What does Faction A's frontline *actually* do that Faction B's doesn't?** "Self-healing vs siege-capable" is a starting frame; the real answer comes from playtest in 3.4.
- **Vision range numbers.** Workers see less than combat units; structures see more than units. Exact tile counts resolve in 3.3 against map scale.
- **Dominance-tick rate scaling.** Linear with Flux share? Quadratic? Capped? Resolves in 3.6 with end-game pacing playtest.
- **Worker counts at saturation per dropoff.** PRD says deposit-based; the optimal worker count per Energy node is a tuning question. Resolves in 3.1 with cycle-time math.

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-26 | Phase 3 opens against Phase 2 architecture (closed). | Multiplayer is now a property of the engine; faction + map depth can be added without re-litigating netcode. |
| 2026-04-26 | Replay format bumps to v2 at first state-shape change; v1 parser retained for the duration of Phase 3. | Phase 3 invalidates v1 replays once. Keeping the v1 parser available means old dev replays remain inspectable. |
| 2026-04-26 | Sub-phase order is fun-first, not foundation-first. | "The game is boring right now" — each sub-phase should change how a match feels. Foundation-first would land 3.0 + 3.1 in a row with no perceptible match-feel change. |
| 2026-04-26 | Tier 3 + faction-specific tech objectives stay optional (per PRD §6.4 / §6.7). | Mitigation against scope blowout. They can land in Phase 4 polish if Phase 3 timeline holds. |
| 2026-04-26 | Sub-phase 3.0 closed. | Structures are first-class sim entities; HQ trains workers only (sim-enforced); combat units come from production buildings. AI / renderer / player input all updated; golden fixtures regenerated for the new sim shape. All Phase 2 gates green. |
| 2026-04-26 | Sub-phase 3.1 closed. | Two-resource economy: Flux gathered alongside Energy via the same deposit-based worker loop with a per-worker `carriedKind` discriminator. ResearchTier2 placeholder validates Flux deduction end-to-end. AI biases one worker toward Flux while pre-research. `REPLAY_VERSION` bumps to 3. |
| 2026-04-27 | Sub-phase 3.2 closed. | Tech-tier flow: Spire (upgrade structure) + tier-2 research + vanguard (tier-2 unit). Build → research → train chain on the player UI; AI extends its build order to include the Spire and prefers vanguards post-research. 3.1's standalone ResearchTier2 retired in favour of the structure-gated ResearchTier2AtStructure (CommandKind 7; slot 6 reserved per the never-reuse-IDs rule). `REPLAY_VERSION` bumps to 4. |
| 2026-04-27 | Phase 3 sub-phases renumbered. | Three new sub-phases inserted ahead of fog: 3.3 (multi-unit selection + move command), 3.4 (unit supply system + map resource expansion), 3.5 (worker energy dump light trail). Old 3.3 fog-of-war → 3.6; old 3.4 faction asymmetry → 3.7; old 3.5 maps-as-data → 3.8; old 3.6 win conditions → 3.9; old 3.7 playtest gate → 3.10. Rationale: with the catalog grown to 4 unit kinds + tier-2 + 3 structure kinds, the player needs basic RTS controls (multi-select + move) and a supply gate before fog of war makes sense as a layer on top. Energy dump is a flavor mechanic that locks in the cyan-faction identity ahead of full asymmetry in 3.7. |
| 2026-04-27 | Phase 3 sub-phases renumbered (second pass). | Four new design asks landed: (1) energy-dump trail must fade and be tech-upgradeable, (2) faction-locked colour resource (Blue/Red) required for every unit + building, regenerating, lockout-by-denial, (3) bigger map + camera pan/zoom, (4) worker resource discovery via scouting (no node knowledge until LOS-detected). Slotted as: 3.3 multi-select unchanged → 3.4 bigger map + pan/zoom (must come before more map content) → 3.5 colour resource (foundational economy retrofit; do once before supply inherits the cost) → 3.6 supply + Pylons (was 3.4) → 3.7 energy dump amended (was 3.5) → 3.8 fog + scouting bundled (scouting requires fog) → 3.9 asymmetry → 3.10 maps-as-data → 3.11 win conditions → 3.12 playtest. 12 sub-phases total. |
| 2026-04-27 | Sub-phase 3.3 closed. | Player-control foundation: drag-rect select, shift-click toggle, right-click MoveUnit per selected unit, multi-worker assign-to-node. New `MoveUnit` command (slot 8) + nullable `moveTarget` on every unit; workers stay parked at the destination (sticky `moveTarget`); raiders/vanguards override the HQ-march temporarily. `autoAssignIdleWorkers` skips parked workers so the player order isn't erased. `REPLAY_VERSION` bumps to 5; golden fixtures regenerated. All Phase 2 lockstep / observer / desync / replay e2e gates green against the new sim. |
| 2026-04-27 | Sub-phase 3.4 closed. | Bigger map (20×20 → 32×32) + camera pan/zoom. `GRID_CONSTANTS.worldExtent` now derived from `gridSize * tileSize`; the lone hardcoded `-10 + 0.5` literal in `scene.ts` removed. New `CameraController` (middle-mouse drag pan, WASD/arrow continuous pan, scroll-wheel zoom 0.5×–2.0×). `main.ts` SPEC re-tuned for the 32-grid (HQs 4,4 + 27,27; 6 Energy nodes; central Flux). Sim shape unchanged → `REPLAY_VERSION` stays at 5; golden fixtures unchanged; all 140 unit tests + 9 e2e gates green. |
| 2026-04-27 | Sub-phase 3.5 closed. | Faction-locked colour resource (Blue / Red), regenerating, lockout-by-denial. `ResourceKind` extends to `'energy' \| 'flux' \| 'blue' \| 'red'`; `FactionState.color`; per-node `regenPerTick` + `maxReserve`; every cost path (`TrainUnit`, `BuildStructure`, `TrainAtStructure`, `ResearchTier2AtStructure`) deducts colour; `AssignWorkerToNode` rejects opposite-colour. New step pass `advanceNode` heals colour nodes ~1 / sec back toward 100. AI generalises 3.1's flux bias for own-colour; `nearestHarvestableNode` filters opposite-colour + depleted. SPEC adds 4 colour nodes + `initialColor: 50`. `REPLAY_VERSION` bumps to 6; golden fixtures regenerated; all 146 unit tests + 9 e2e gates green. |
| 2026-04-27 | Sub-phase 3.6 closed. | Supply system + Pylon. `FactionState.supplyCap` (initial 10, +8 per Pylon) + `supplyUsed`; `UnitStats.supplyCost` (1/2/2/4); new `StructureKind = 'supply'`. `TrainUnit` + `TrainAtStructure` reject at cap; `TrainAtStructure` reserves supply at queue time so two Forges can't double-book. `applyDamage` decrements supplyUsed on death (centralised — every kill flows through here). End-of-step `recomputeSupplyCaps` pass derives cap from operational Pylon count. AI builds Pylon when `supplyUsed >= cap - 2` and no Pylon already in progress. SPEC splits central Flux into two flank-symmetric Flux nodes. UI: BUILD PYLON button + HUD `s N/M` + `supply blocked` reason. Renderer: faction-coloured pylon mesh. `REPLAY_VERSION` bumps to 7; golden fixtures regenerated; all 151 unit tests + 9 e2e gates green. |
| 2026-04-27 | Sub-phase 3.7 closed. | Worker energy dump + light trail + tech-upgradeable duration. New `Trail` entity in `state.trails`; `Worker` gains `dumpTicksRemaining + dumpCooldownTicks + activeTrailId`; `FactionState.trailDurationResearched`; `UpgradeStructure.researchKind` discriminator (`tier2 \| trailDuration \| null`). New commands `ActivateEnergyDump` (slot 9) + `ResearchTrailDurationAtStructure` (slot 10). Two new step passes — `trailKillSweep` (kills overlapping non-owner units) + `advanceTrails` (ages segments, drops expired, kills empty trails). Effective lifetime is faction-research-aware at expiry-time so an in-flight trail extends the moment the research lands. UI: DUMP button + `E` hotkey + TRAIL+ research button. Renderer: per-trail group of small glowing segment tiles, opacity + emissive intensity fade with age. `REPLAY_VERSION` bumps to 8; golden fixtures regenerated; all 157 unit tests + 9 e2e gates green. |
| 2026-04-27 | Sub-phase 3.8 closed. | Fog of war + permanent node discovery. `ResourceNode.discoveredBy: [boolean, boolean]`; per-kind `visionRadius` on UnitStats + StructureStats + `HQ_VISION_RADIUS`. New step pass `advanceDiscovery` flips per-faction bits as friendly entities walk into LOS. Initial sweep at `createInitialState` pre-discovers home-patch nodes so AI + player can bootstrap. AI's three node-finder helpers gained the discovery filter. Renderer hides enemy units / structures / HQs outside friendly vision and undiscovered nodes; observer mode bypasses. Sim itself doesn't gate AssignWorkerToNode on discovery — that's a presentation + AI concern, not a sim rule. `REPLAY_VERSION` bumps to 9; golden fixtures regenerated; all 161 unit tests + 9 e2e gates green. |
| 2026-05-06 | Phase 3 sub-phases renumbered (third pass) — new 3.9 inserted: game feel & presentation pass. | Owner playtest read: "the game feels disconnected — units are tiny, buildings are all one cell, fog isn't visible, workers auto-assign on spawn (no agency), no click feedback, no menu, no sounds." 3.0–3.8 shipped a complete RTS *loop* but match *feel* hasn't been touched since Phase 1, and the (now) 3.10 faction-asymmetry sub-phase would land twice as much content into a build the player doesn't enjoy reading. Slotted as 3.9 ahead of asymmetry: input feedback + spawn-agency + visual scale + fog overlay + audio + animation + main menu, fun-per-effort ordered. Sim shape moves only for `tileFootprint` on `StructureStats` and optional `rally` on production structures; expected `REPLAY_VERSION` bump to 10 once the footprint item lands. Old 3.9 (asymmetry) → 3.10; 3.10 (maps-as-data) → 3.11; 3.11 (win cond) → 3.12; 3.12 (playtest) → 3.13. 13 sub-phases total. |
| 2026-05-07 | Sub-phase 3.9 closed. | Game feel + presentation pass: 7 work items shipped — input feedback overlay (move ping / assign pulse / placement burst + cursor states); `autoAssignIdleWorkers` stripped from player paths so newly trained workers wait for orders; visual scale-up of all entities (1.4–2.0× depending on kind) + AI placement offsets nudged to clear bigger silhouettes; Tron-style fog of war (uncover-as-explore metaphor with grid intensity bump 0.4 → 1.2 to give the layer something to obscure); 5-cue WebAudio synthesis layer with `M`-mute toggle; placement + death pulse animations surfaced from latent legacy mesh code; main menu DOM scene with PvAI flow + `?menu=skip` test bypass. Sim shape unchanged across all seven items — `REPLAY_VERSION` stays at 9, no fixture regen needed. Three e2e tests updated to use `?menu=skip`. Two debug specs (fog-debug, menu-debug) dropped at close. All 161 unit tests + 9 e2e gates green. |
| 2026-05-07 | Sub-phase 3.10 closed. | Selection-driven action bar (HQ/worker/forge/spire/pylon → context-specific buttons; faction-coloured cost glyphs; hotkey badges; tooltip disabled-reasons) replaces the Phase 1 always-on flat panel. New `selectionRing` + raycast registries on structures + HQ. Worker-driven building (`BuildStructureByWorker` slot 11; `AssignWorkerToBuild` slot 12) — workers walk to construction sites + decrement `buildTicksRemaining` while on site, multi-worker stacks throughput. Workers spawn around the HQ perimeter via `FactionState.nextSpawnRotation` round-robin through eight offsets (no more selection-collision with the bigger HQ silhouette); they deposit at the HQ perimeter (`HQ_DEPOSIT_REACH_SQ` widened from 0.06² to 2.0²). Construction visual: y-scale rise from 15% → 100%, faction-coloured pulsing scaffolding ring at the base while building, Spire's finial / Pylon's cap appear past completion thresholds for evolving silhouette. AI dispatches via `pickIdleBuilderWorker` (idle > moving/returning > building, lowest-id tiebreaker). Legacy `BuildStructure` (slot 4) retained for tests + back-compat — spawns structures with `builtByWorker = false` so they auto-tick the build phase. `?test-hooks=1` URL flag exposes `__vyluxTest.{selectHq, selectStructure, selectAllOwnWorkers, sim}` for e2e specs. `REPLAY_VERSION` bumps to 10; golden fixtures regenerated. All 161 unit tests + 9 e2e gates green. |
| 2026-05-07 | Phase 3 sub-phases renumbered (fourth pass) — new 3.10 inserted: in-game HUD / action-bar redesign (context-sensitive). | Owner feedback after 3.9 landed: the in-match buildables panel reads as "a wall of cards of information" rather than a guided action bar — every command always visible, no cue about what the natural next move is, upgrades indistinguishable squares of text. The fix: make the bar **context-sensitive** (HQ selected → train workers; worker selected → build options; Forge selected → combat units; Spire selected → research) with bigger button affordance, icons, hotkey letters, faction-coloured cost glyphs, and tooltip-based disabled reasons. Sim untouched (same commands, different UI). Slotted as 3.10 before faction asymmetry — same "fix the lens before adding more content" rationale as the 2026-05-06 game-feel insertion. Old 3.10 (asymmetry) → 3.11; 3.11 (maps-as-data) → 3.12; 3.12 (win cond) → 3.13; 3.13 (playtest) → 3.14. 14 sub-phases total. |
| 2026-05-07 | **PvE pivot — Vylux retires the competitive 1v1 / esport ambition; sub-phases 3.11–3.14 repointed for single-player PvE wave-defense + roguelike-run shape.** | Honest market read: indie competitive 1v1 RTS is one of the hardest possible monetization paths (Stormgate had ex-Blizzard talent + ~$40M and still struggled badly); solo dev + browser tech + a genre that needs concurrent-player critical mass to feel alive was the wrong combination. The PvE shape leverages 80% of what's already built (deterministic sim, renderer, full catalog, AI scaffolding all carry forward unchanged), ships in vertical slices, can be put in front of players immediately, and removes the "owe paying customers a competitive ladder" obligation. **Repointed sub-phases:** 3.11 = enemy AI faction(s) with distinct rosters as the player's adversary (was: two playable factions balanced for ladder); 3.12 = scenarios as data + seedable runs (was: maps as data for the matchup matrix); 3.13 = PvE win conditions — survive-N-waves + scenario objective + resign (was: military elimination + dominance-tick + 25-min timer); 3.14 = run-loop fun gate (was: esport balance gate). **Dormant code:** all of `src/net/` (lockstep, WebRTC, observer, signaling) — preserved end-to-end so optionality isn't paid to delete + rebuild, but **not on the active surface**. **Determinism contract** kept and reframed as engineering hygiene (save/load, replays-as-bug-reports, scripted scenarios, AI testing) rather than esport-grade lockstep prerequisite. **Mechanical-mastery pillar** (full keyboard parity, control groups, camera bookmarks, smart-cast, production-anywhere) softened to "comfortable mouse + hotkeys; rebindable bindings deferred." **PRD §8 Phases 4 + 5 replaced**: new Phase 4 = run loop & meta-progression; new Phase 5 = content + optional Steam release as stretch. Historical decision-log rows above are kept intact as the record of how we got here — text in this doc and in the PRD wins where it contradicts a prior entry. See PRD §0 + AGENTS.md "2026-05-07 pivot" callout. |

## Known follow-ups

Carried over from sub-phase closes — small enough not to reopen the closed sub-phase, big enough to want a written reminder.

| From | Item | Notes |
|---|---|---|
| 3.10 | Multi-worker placement-click dispatches only the first selected worker. | `input-controller.ts` `handlePointerDown` placement branch queues `BuildStructureByWorker` for `pendingPlacementWorkers[0]` and discards the rest. Right-click on an in-progress structure (3.10.7) covers the "add more builders after the fact" intent, but the "I had 4 workers selected when I clicked place" intent only dispatches one. Fix path: capture `state.nextEntityId` immediately before queueing the build, then queue `AssignWorkerToBuild` for `rest` against that predicted id. Couples input to a sim invariant (id monotonicity), but the invariant is already a documented contract in `state.ts`. |

## Next investigation

Phase 4 (Steam Early Access — Steamworks SDK, Tauri/Electron wrapper, ladder, seasons) gets its own doc when Phase 3 closes. Until then, the PRD §8 paragraph plus §5 launch-scope list are sufficient for long-range orientation.
