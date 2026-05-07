# Vylux — Product Requirements Document

> **Status:** Draft v5 (PvE pivot — single-player wave-defense + roguelike-run shape; competitive 1v1 / esport ambitions retired). Supersedes v4 (esport pivot) and the prototype-era PRD.
> **Owner:** Jaco
> **Last updated:** 2026-05-07 (Phase 3.0–3.10 implemented under the v4 esport direction; pivot to PvE landed same day; sub-phases 3.11–3.14 repointed)

---

## 0. Pivot notice (read this first)

Vylux was originally pitched as a **competitive 1v1 RTS aimed at Steam release with a credible esport footprint**. Phases 0, 1, 2 and sub-phases 3.0–3.10 were built against that target. As of 2026-05-07 the direction has changed:

- **Vylux is now a single-player PvE Tron-grid RTS**, structured around **wave-defense + roguelike runs**: hold the grid against escalating waves of enemy raiders, pick tech upgrades between waves, survive the run, restart with new seeds and unlocks.
- The **deterministic sim, the Tron aesthetic, the catalog (workers / forge / spire / pylon / fog / supply / colour resource / action bar), the AI scaffolding, and the renderer** all carry across the pivot unchanged. The pivot is a *design* shift, not a technical rewrite.
- The **lockstep / WebRTC / observer multiplayer code** under `src/net/` is **dormant**: preserved for optionality (so we don't pay to delete and rebuild), but **not on the active surface**. No new esport / ladder / spectator / matchmaking work happens without a fresh pivot conversation.
- The **mechanical-mastery / keyboard-first pillar** (formerly §3.8) is **softened, not retired**: good keyboard control still matters, but full rebindable parity is no longer a launch-blocking commitment. Hotkeys for common actions stay.
- The **Phase 8 plan is replanned** for Phases 4 and 5 (run loop & meta-progression, then content + optional Steam release). Phases 0–3 remain accurate as a historical record of how we got here; the closed sub-phases (0.x, 1.x, 2.x, 3.0–3.10) are not re-litigated.

The prior decision-log entries below — and in `docs/investigation/04-phase-3-faction-and-map-depth.md` — are kept intact as the historical record. Where the current text contradicts a prior entry, the current text wins.

Why the pivot: the indie competitive-1v1 RTS market is brutal even for funded studios. Solo dev + browser tech + a genre that needs concurrent-player critical mass to feel alive was the wrong combination for "make money on Steam." The PvE shape leverages 80% of what's already built, ships in vertical slices, can be put in front of players immediately, and removes the "owe paying customers a competitive ladder" obligation.

---

## 1. Vision

Vylux is a **fast, legible, single-player real-time strategy game** wrapped in a Tron-inspired neon-on-charcoal aesthetic. You command a small base on a glowing grid against an escalating AI adversary; you make economic, tech, and tactical decisions under pressure; the run ends in either survival or defeat, and the next run starts with a different seed.

The bet: _readability + depth + a tight, deterministic simulation_ make for an RTS that is **fun to play in 15-minute sessions, replayable across many runs, and honest about being a solo-dev game.** Tron-minimal art is a feature, not a budget compromise — high-contrast silhouettes are easier to read at a glance, which matters more in a wave-defense pressure cooker than it does in a leisurely build-up.

The product target is a **finished, satisfying single-player RTS** that an interested player can finish a run of in under 20 minutes and want to start again. Steam release is a **stretch goal**, not a commitment — see §8 Phase 5. The web build remains the canonical distribution channel.

## 2. North-star outcomes

In rough priority order, success at the end of the phase plan in §8 looks like:

1. **A run loop that's fun.** A player picks up the game cold, plays a 15-minute run, dies (or wins), and clicks "new run" because the next seed sounds interesting. This is the gate everything else is downstream of.
2. **Multiple viable run shapes.** Eco-rush, harass-rush, turtle-and-tech all produce winnable runs against different seeds. No single dominant build order.
3. **Meta-progression that respects time.** Unlocks accumulate across runs; a player who has 10 hours in feels their roster / option space has grown without making the game trivial.
4. **A small, hand-tuned content set.** 3–6 distinct scenario shapes (open arena, bottleneck, three-flux, asymmetric defender, gauntlet, boss). Not a procedural-everything game.
5. **Honest engineering.** Determinism is preserved as engineering hygiene (save/load works, replays-as-bug-reports work, scripted scenarios are reproducible) — not as a marketing claim about competitive integrity.

Things that are explicitly **not** north-star outcomes:
- 1v1 ranked ladder, Glicko-2, seasons, matchmaking, queue health metrics.
- Live spectator mode, observer API, broadcast overlays, tournament infrastructure.
- A community-run tournament. (If it happens organically post-launch, fine; we don't build for it.)
- Microtransactions, battle passes, cosmetic store, gacha.
- Esport-grade balance discipline (winrate ±5%, faction-pick parity at high MMR).

This horizon is **multi-quarter, not twelve months**. The phase plan in §8 is sequenced — Phase N+1 begins when N's exit criteria are met — and rushing it is the failure mode, not slipping it.

## 3. Pillars (load-bearing design constraints)

These are the constraints every feature must answer to. If something violates a pillar, it does not ship — even if the prototype already had it.

### 3.1 Deterministic simulation

The simulation is **frame-rate independent, integer-or-fixed-point, seeded, and bitwise reproducible** across machines and OSes. Same inputs in, same state out, every time. Floating-point trig and `requestAnimationFrame`-driven updates are forbidden inside the sim.

Determinism is no longer load-bearing for the *product* (no lockstep multiplayer to be the gate for) — but it remains load-bearing for the *engineering*:

- **Save / load works for free.** A run is `(seed, command_log)` — no need to serialise full state.
- **Replays-as-bug-reports.** A player who hits a weird behaviour exports the replay; we reproduce the exact run on our machine.
- **Scripted scenarios are reproducible.** A "wave 7 of the bottleneck map" scenario for a designed encounter plays the same every time.
- **AI testing.** Two AI variants race against each other on the same seeds; differences in outcome are signal, not noise.
- **Cross-OS regression catch.** The cross-OS CI workflow flags accidental float introductions early — cheap insurance.

The cost of preserving this property is real (Q16.16 fixed-point, no `Math.random`, no `Math.sqrt` in hot paths) but the cost has already been paid in Phases 0–3. We don't go *out of our way* to add new uses of determinism, but we don't break the contract for convenience either.

### 3.2 Render/sim separation _(was §3.3 in v4)_

Rendering is a **read-only consumer** of sim state. The sim ticks at a fixed rate (target 20 Hz, possibly 30); the renderer interpolates between sim states and never writes back. This is what makes determinism survive the move to a real game with animations, juice, and graphical settings, and it's what lets fog of war / vision filtering work cleanly.

### 3.3 Replays as engineering tools _(was §3.4 in v4)_

A replay is the input log + the seed + the version. Every match produces one. The same binary that plays the game plays the replay. Replays are bug-report material and scenario-authoring fixtures; they are **not** consumer-facing artifacts that need browse / scrub / share UI (that was a Phase 5 esport commitment in v4 and is now retired).

### 3.4 Readability over fidelity _(was §3.5 in v4)_

Tron neon-on-charcoal, high-contrast silhouettes, readable at a glance. **No** post-process bloom that washes out unit edges. **No** unit designs that read identically at small scale. In a wave-defense game where the player is reading 30+ enemies bearing down on the base, glance-readability is a P0 concern.

### 3.5 Depth via asymmetry, not breadth _(was §3.6 in v4)_

Two **gameplay shapes** at launch — the player faction and the enemy AI faction — with **meaningfully different macros** (build-order pressure, unit composition, threat profile) beat six factions with cosmetic differences. The enemy faction(s) are not "just the player faction wearing red" — they have different rosters, different threat curves, different "scary moments" in the run. Adding a second *playable* faction is a stretch (Phase 5+); the first commitment is shipping one playable faction against multiple distinct enemy factions / waves.

### 3.6 Run-loop pacing is the design centre

The single most important design lens, and the one most different from v4. A Vylux run is built around a **rhythm of build → wave → recover → tech → harder wave → escalation → climax**. Specifically:

- **Build phase** (early): worker economy, first defensive structures, scout the map. ~2–4 minutes of mostly-uninterrupted setup. Gentle early waves to teach without punishing.
- **Wave phase**: enemy raiders attack from a known direction at a known cadence. The player reads the wave, positions defenders, holds.
- **Recovery / tech phase**: between waves the player re-economies, repairs, picks a tech upgrade from a small offered set (roguelike-flavour: 3 random options, pick 1).
- **Escalation**: each wave is harder than the last; resource pressure grows; map control matters more.
- **Climax**: a final boss-wave or scenario-specific objective, after which the run ends in survival or defeat.

The run is paced so a player who is paying attention can survive; a player who isn't makes mistakes that compound. The pacing curve, not the unit balance, is the load-bearing tuning surface.

### 3.7 Mechanical accessibility, not mastery _(softened from v4 §3.8)_

A PvE RTS does not need to support a 300-APM esport top end. It does need to be **comfortable to play with both mouse and keyboard**, with hotkeys for common actions. Concretely:

- **Hotkeys for the action bar.** Letter shortcuts on every button (already shipped in 3.10).
- **Idle-worker hotkey.** A single key cycles idle workers — still a quality-of-life improvement, still planned.
- **Camera pan + zoom.** Already shipped (Phase 3.4).
- **Mouse-only is a fully supported path.** A new player should never feel like the game requires keyboard chord memorisation.

What's **deferred from v4 commitments**:
- Full rebindable bindings UI (was a Phase 4 esport commitment). Defaults are good enough; rebinding can land if playtest demands it.
- Control groups (`Ctrl+1..9` bind / recall / add). Not a wave-defense necessity. Add if a scenario design genuinely needs it.
- Camera bookmarks bound to F-keys. Same — only if a scenario asks for it.
- Production from anywhere. The action bar is selection-driven; if production-anywhere becomes a UX pain, we add it as a one-off, not as a parity commitment.
- Smart-cast on abilities. If/when abilities exist, default to target-where-cursor; don't over-engineer.

This pillar is **softer** than v4's §3.8: we want comfortable play, not competitive depth in the input layer.

## 4. Players we are designing for

Three personas, replacing v4's ladder-climber / aspiring-pro / curious-tourist set.

| Persona | What they need | When we serve them |
|---|---|---|
| **Run Player** | A 15–20 minute run that has shape (build, escalate, climax). Variety across runs (different seeds / scenarios / picks). A fair death they can read. | Phase 4 onward (the run-loop is what Phase 4 *is*). |
| **Tinker / Optimiser** | Multiple viable strategies, meaningful tech-pick decisions, a small unlock tree that opens up over hours. Replays of their best runs (downloadable, not shared). | Phase 4 + 5 — meta-progression + content. |
| **Curious Tourist** | A playable web build, a 5-minute "what is this" path, a scenario that doesn't require tutorialisation to enjoy. | Phase 3.13 onward (PvE win conditions land an honest first run). |

The **competitive ladder player and aspiring pro are not in scope** — that was the v4 audience. They're welcome to play but the game isn't tuned for them.

## 5. Scope — in and out

### In scope (target launch shape, web build first)

- **Single-player PvE.** Player vs scripted enemy AI on the deterministic sim.
- **Wave-defense + roguelike-run structure.** A run is a sequence of waves on a chosen scenario; between waves the player picks one of three offered tech upgrades.
- **One playable faction at launch.** With distinct units, structures, tech tree, energy-dump mechanic. Phase 5 stretch: second playable faction.
- **Multiple enemy AI factions.** At least two distinct enemy compositions (e.g. "Pulse swarm — fast, fragile, many" and "Forge siege — slow, heavy, few"). Different waves draw from different enemy factions.
- **3–6 hand-tuned scenarios.** Open arena, bottleneck, three-flux, asymmetric defender, plus 1–2 stretch (gauntlet, boss).
- **Tech-pick screen between waves.** Roguelike-style 3-of-N offered upgrades; choices accumulate within a run.
- **Meta-progression.** Persistent unlocks across runs (new tech options, new scenarios, new starting conditions). Not pay-to-progress; just "play more, see more."
- **Save / resume.** A run can be saved and resumed (free from determinism — `(seed, command_log)`).
- **Replays.** Per-run JSON download; headless replay tool. Not a shared social feature.
- **AI opponent at 2–3 difficulty tiers.** "Easy / standard / hard" per scenario.
- **Web build canonical.** `npm run dev` / `npm run build` → host as static site. No installer required.

### Out of scope (deferred to a hypothetical Phase 5 stretch)

- Steam release. **Stretch only.** Tauri/Electron wrap of the existing web build is the path if it happens — no Steamworks rewrite. See §8 Phase 5.
- Single-player narrative campaign with cutscenes and story. The game has scenarios, not chapters.
- Second playable faction. One playable faction at launch; a second is a stretch.
- Mobile / touch / console.

### Out of scope (explicitly retired from v4)

- 1v1 ranked + unranked.
- Lockstep multiplayer as a player-facing feature. **Code is dormant** under `src/net/` — preserved for optionality, not exposed.
- Glicko-2-style ranked ladder, seasons, matchmaking signals, queue tuning.
- Live spectator mode, observer API, broadcast overlays, tournament-mode lobby.
- Replay sharing UI (browse, scrub, comment).
- Steam Cloud, Steam achievements, Steam friends integration as a launch commitment.
- Anti-cheat-by-construction as a marketing claim. (The sim is still deterministic; we just don't sell it as anti-cheat anymore.)
- Full keyboard parity / customisable bindings UI as a launch commitment (see §3.7).

### Out of scope (forever, unless re-pitched)

- Pay-to-win mechanics.
- Loot boxes, gacha, or any RNG monetisation.
- Microtransactions of any kind.
- Mod tooling or custom scenario editor for end users (we author scenarios; players play them).

## 6. The match — PvE surface

This section is opinionated. It commits to the **shape** of a run — what systems exist, what they do, how they interact. Concrete numbers (HP, damage, costs, gather rates, tick budgets, wave compositions) are deferred to design docs that come during sub-phases 3.11–3.14 and Phase 4.

> **Current catalog of what's actually in the game** (units, structures, resources, tech, controls, the launch map): see [`docs/manual.md`](../manual.md). This PRD describes the design intent; the manual describes the current shipped state. They diverge by design — the PRD is forward-looking, the manual is current. When a sub-phase ships a change, the manual updates with it; the PRD updates only when the design intent itself shifts.

The current build's "race to 100 points or HQ destruction" is **not** the run-loop shape. It's the holdover from when this was a competitive 1v1 game; sub-phase 3.13 replaces it with the wave-based shape below.

### 6.1 Length & pacing

- **Run length target:** 12–20 minutes for a successful run; 5–15 for a failed one. Long enough for tech decisions, short enough that "one more run" is a tractable ask.
- **Wave cadence:** 60–90 seconds between waves at the start, narrowing as the run progresses. Final 2–3 waves come faster, putting the player in genuine resource pressure.
- **Pacing rewards reading the wave.** A player who scouts the next wave's composition and re-positions accordingly outperforms a player who plays the same opener every time. Pacing is **playtest-driven**, not a hard metric.
- **No hard timer.** v4 had a 25-minute timer to prevent esport stalemates; PvE has no such concern. The run ends when the player wins, dies, or quits.

### 6.2 Information model — fog of war _(unchanged from v4 §6.2)_

Vylux ships with **partial fog of war**. The terrain (the grid itself, energy nodes' positions) is gradually revealed as the player explores; **enemy units and structures are hidden** until they enter friendly vision. Vision is provided by units (each has a vision radius) and by structures (HQ + production buildings provide larger but stationary vision).

- **Why partial, not full:** the Tron neon palette is a readability asset; black-fogged terrain on top of dark-charcoal grid would fight that. Terrain-always / entities-fogged keeps the map readable while preserving the scouting decision.
- **Sim has full state, renderer enforces.** Even though there's no anti-cheat case to make in PvE, the architectural separation is good engineering hygiene and makes scenario design easier (the sim authors waves with full knowledge; the renderer presents them as discoveries).
- **Scouting is a real action.** Sending a worker or a fast scout unit to spot the next wave's spawn direction is part of macro play.

### 6.3 Economy & resources _(unchanged from v4 §6.3)_

**Three resources**, in the shape Phase 3.5 + 3.6 already shipped:

- **Energy** — primary, plentiful, gathered from scattered nodes. Workhorse for all unit / structure costs.
- **Flux** — scarce and contested. Required for tier-2 production and advanced tech.
- **Colour (Blue / Red)** — faction-locked secondary resource on a small set of nodes; regenerates passively. Lockout-by-denial creates pressure when the enemy contests your colour.

The **deposit-based gather loop** (gather → return-to-dropoff → unload) stays. Workers don't trickle.

In PvE, **enemy raids on your harvesters** become a primary failure mode. A player who doesn't defend their workers loses their economy mid-wave; a player who garrisons the right node holds.

### 6.4 Tech & production _(unchanged from v4 §6.4)_

Production is **building-gated, not HQ-only**:
- **HQ** trains workers and provides base economy.
- **Production buildings** (Forge for combat units, Spire for research, Pylon for supply) — already shipped in Phase 3.0–3.10.
- **Tech tiers**: Tier 1 from the start, Tier 2 unlocked at the Spire.

In PvE, the tier-2 research becomes a **strategic timing decision**: spend 80 ticks researching now and you're vulnerable to the wave that lands at tick T+80; delay and you face wave N+1 with tier-1 only.

### 6.5 Counter structure — units & roles _(largely unchanged from v4 §6.5)_

Three role primitives every wave fields, plus tech-tier counters:
- **Eco** — workers (player only; enemy waves don't have eco units).
- **Frontline** — high HP, holds choke points.
- **Harass** — low HP, fast, punishes scattered economy.
- **Specialist** (tier 2+) — siege, anti-frontline, support.

The counter triangle still applies: frontline counters harass, harass counters eco, eco runs from everything. The PvE twist: the **enemy waves are designed to test specific player decisions**. A "pure-harass" wave punishes a player who built only frontline; a "siege" wave punishes a turtle that didn't expand.

### 6.6 Map / scenario model

- **Tile-based, isometric.** The grid stays. No height/elevation in launch scope.
- **Scenarios as data.** A scenario is `(map_layout, starting_resources, wave_schedule, win_condition)` — all data, not code. Sub-phase 3.12 lifts this out of `main.ts`'s hardcoded SPEC.
- **Hand-tuned + seeded.** Map layouts are hand-tuned; per-run variation comes from **seed-driven wave composition + tech-offer rolls**, not procedural map generation.
- **3–6 launch scenarios** with distinct shapes:
  - **Open arena** — symmetric, no choke. Tests army composition.
  - **Bottleneck** — central choke. Frontline-favoured.
  - **Three-flux** — three contested Flux nodes. Tests map-control decisions.
  - **Gauntlet** (stretch) — narrowing arena, waves push you back.
  - **Boss** (stretch) — single high-HP enemy unit with a designed mechanic.

### 6.7 Win & loss conditions

PvE win conditions, replacing v4's military-elimination-or-dominance set:

1. **Survive the scheduled waves.** The run has a defined wave count (e.g. 8 waves on standard, 12 on hard). Surviving the final wave wins the run.
2. **Complete the scenario objective.** Some scenarios have a custom objective: hold a specific node for N waves, escort a structure to a destination, destroy an enemy spawner. Scenario-defined.
3. **Defeat the boss** (boss-scenarios only). Final wave is a single boss enemy with a designed mechanic.

Loss conditions:
- **HQ destroyed** → defeat.
- **All combat-capable units killed and HQ defenseless mid-wave** → defeat (functionally the same as above; just faster).
- **Resign** is a first-class action (already planned, lands when win-conditions land in 3.13). Replays save on resign.

There is **no hard timer**. There is no "dominance tick." Both were esport scaffolding.

### 6.8 Run-pressure curve _(replaces v4 §6.8)_

Pressure comes from **wave escalation and resource scarcity**, not from a dominance clock.

- **Wave difficulty scales** non-linearly: waves 1–3 are gentle, 4–6 punishing, 7+ require real preparation.
- **Resource nodes deplete** mid-run. The player who didn't expand by wave 5 runs out of Energy at wave 7. Expansion is a real decision under pressure.
- **Tech picks compound.** A "1.5× harvest rate" pick early sets up a different mid-game than "+50% defender HP." Variety across runs comes from the pick path, not just the seed.
- **Comebacks come from positional play and lucky tech picks.** A player who lost their main base but holds a forward Forge with a strong tech-pick stack can claw back. There is no rubber-band buff.

### 6.9 Control & input _(replaces v4 §6.9; aligned with new §3.7)_

- **Mouse-only is fully supported.** A new player can finish a run mouse-only.
- **Action-bar hotkeys** for every common command (already shipped).
- **Camera pan + zoom** (already shipped).
- **Idle-worker hotkey** — planned, lands when scope demands.
- **Customisable bindings, control groups, camera bookmarks, production-anywhere, smart-cast** — **deferred** unless playtest demands. Not launch commitments.

## 7. Technical North Star

| Concern | Target |
|---|---|
| Sim tick rate | 20 Hz (configurable, must support 30) |
| Sim → render | Pull-only; renderer interpolates, never writes |
| Determinism | Bitwise reproducible across Win/macOS/Linux (already passing) |
| Numeric model | Fixed-point (Q16.16) for any value affecting state |
| RNG | Single seeded PRNG per run; no `Math.random()` in sim |
| Save format | `{ version, seed, scenario, command_log }` — re-derive state by replay |
| Replay format | Same as save format. One artifact, two uses. |
| Renderer | Three.js (committed); orthographic isometric camera; Vite build; TypeScript strict |
| Sim layer | TypeScript with fixed-point (committed; Phase 0 closed this question) |
| Distribution | **Web build (canonical)** — static site, no installer. Tauri / Electron wrap is a Phase 5 stretch only if Steam happens. |
| Net model | **Dormant.** Lockstep + WebRTC + observer code preserved under `src/net/`; not exposed in active product surface. |

## 8. Phases

This is a working sequence, not a Gantt chart. Phase N+1 begins when N's exit criteria are met.

**Phase 0 — Determinism Spike** _(closed)_
Two browser tabs run a scripted match and produce bit-identical state hashes for 10 minutes; replay round-trip; one-tick desync detection. See `docs/investigation/00-determinism-and-netcode.md`.

**Phase 1 — Sim Rewrite** _(closed)_
Prototype gameplay (HQ, workers, energy, three units) ported onto the deterministic sim. See `docs/investigation/02-phase-1-sim-rewrite.md`.

**Phase 2 — Multiplayer Alpha** _(closed pre-pivot, now dormant)_
Lockstep over WebRTC, relay server, observer prototype. **The code works and tests pass; it is not on the active product surface.** Don't extend without re-pitching the pivot. See `docs/investigation/03-phase-2-multiplayer-alpha.md`.

**Phase 3 — Faction & Map Depth** _(active — 3.0–3.10 closed; 3.11–3.14 repointed for PvE)_
Mechanical depth: structures, two-resource economy, fog, supply, action bar, worker-driven building. The remaining sub-phases pivot toward the PvE shape:
- 3.11 — enemy AI faction(s) — distinct rosters / threat profiles, not "your faction in red".
- 3.12 — scenarios as data + seedable runs (lifts SPEC out of `main.ts`).
- 3.13 — PvE win conditions: survive-N-waves + scenario objective + resign.
- 3.14 — playtest gate: "is the loop fun" — ≥20 internal runs across scenarios; player wants to start another run.

See `docs/investigation/04-phase-3-faction-and-map-depth.md` for sub-phase detail.

**Phase 4 — Run loop & meta-progression**
Roguelike skeleton: between-wave tech-pick screen, per-run upgrade tree, persistent unlocks across runs. Save / resume. Difficulty tiers per scenario. AI tuning per difficulty. Exit: a player can complete 5 distinct successful runs across scenarios + difficulties; meta-unlock economy feels worth pursuing in playtest.

**Phase 5 — Content + optional Steam release**
Hand-tune the full launch scenario set (3–6 distinct shapes); polish; tutorial-by-design (the first scenario teaches without a tutorial UI); audio polish; main-menu run-history view. **Optional:** Tauri/Electron wrap for Steam release if and only if the web build has demonstrated organic interest; this is a stretch goal, not a Phase 5 commitment. Exit: launch-ready web build that a player can find, play, and finish without prior context.

**Retired phases (from v4):**
- v4 Phase 4 (Steam Early Access — Steamworks SDK, Glicko-2 ladder, seasons, friend invites). Replaced by current Phase 4 + the Steam-as-stretch in Phase 5.
- v4 Phase 5 (Ladder & Esport Hooks — replay sharing UI, live spectator delay, observer API, tournament-mode lobby, broadcast overlay). **Retired entirely.**

## 9. Risks — ranked

1. **The PvE design isn't fun.** This is the biggest risk by a wide margin. The competitive 1v1 risk was "can we ship it"; the PvE risk is "do people enjoy it once we do." Mitigation: ship a playable run-loop end-to-end fast (sub-phases 3.11–3.13 + a thin Phase 4) and put it in front of real players before authoring 3+ scenarios. If the loop isn't fun at one scenario, no amount of content fixes it.
2. **Scope blowout via meta-progression.** Roguelike unlock trees are bottomless. Mitigation: the launch unlock tree caps at ~20 nodes. Not 200. We commit to that number in Phase 4's investigation doc.
3. **Solo-dev throughput.** Same as v4. Mitigation: the PvE pivot reduces the *required* scope (no ladder, no matchmaking, no spectator) by more than it adds (run-loop + meta + scenario authoring). Net throughput should improve.
4. **Determinism regression during PvE work.** Sub-phases 3.11–3.13 still touch `SimState` (enemy faction state, wave scheduler state, win-condition state). Same mitigation as Phase 3 generally: regenerate fixtures at each sub-phase close, accept mid-flight cross-OS flakiness.
5. **The competitive RTS market is crowded** _(carried from v4)._ Less relevant post-pivot — PvE indie RTS is a less-saturated niche (They Are Billions, Northgard, Tooth and Tail). Still: don't pretend we have a guaranteed audience.
6. **Engagement-fatigue without multiplayer**. v4's bet was "multiplayer drives long-tail engagement." PvE replaces that with "roguelike replayability." If the seed/pick variety isn't enough, players bounce after 2–3 runs. Mitigation: meta-progression unlocks are the primary lever; scenario variety is secondary.

## 10. Non-goals (what this PRD does not commit to)

- A specific art style beyond "Tron-inspired neon-on-charcoal."
- A launch date.
- A revenue model. Web build is free / freemium / pay-what-you-want — TBD per Phase 5. Steam release (if it happens) is paid.
- Multiplayer. Code stays dormant; the moment we want it back as a product feature is its own pivot conversation.
- A specific number of scenarios beyond "3–6 at launch."

These will be settled by the investigations and phase exits referenced above.

## 11. What survives from prior phases

The pivot is a **design** shift, not a technical rewrite. Almost everything built in Phases 0–3 carries forward.

**Carries over (used as-is):**
- The **deterministic sim core** (`src/sim/`). Reframed (§3.1) but unchanged in code.
- The **renderer** (`src/render/`). Unchanged.
- The **catalog** — workers, defenders, raiders, vanguards, Forge, Spire, Pylon, energy / flux / colour resources, supply, fog, energy-dump trails, action bar.
- The **AI scaffolding**. The PvE pivot needs *more* scripted-AI work, not less; the current `tickAi` becomes the foundation for enemy-faction AI in 3.11+.
- **Replays + headless replay tool**. Reframed as engineering artifact (§3.3); same code.
- **Save / resume** falls out of the determinism contract for free.
- The **Tron aesthetic and concept references** (`docs/concepts/`).

**Dormant — preserved for optionality:**
- All of `src/net/` (lockstep, WebRTC, observer, signaling). Don't extend without re-pitching the pivot. Tests still pass and run in CI.

**Carries over with reframing:**
- The `src/main.ts` SPEC — becomes data-driven scenarios (Phase 3.12); current shape is a single hardcoded scenario.
- The match-end overlay — becomes the run-end / wave-end overlay.

**Doesn't carry over (retired with the pivot):**
- The **"100-point threshold or HQ destruction"** win condition. Replaced by PvE win conditions in Phase 3.13.
- The **competitive matchmaking / ladder / tournament** vocabulary throughout v4. Retired.
- The **mechanical-mastery commitments** (full keyboard parity, control groups, camera bookmarks, smart-cast, production-anywhere) as launch requirements. Soft / deferred (§3.7).
- The **anti-cheat-by-construction** framing. Determinism is engineering hygiene now, not a marketing claim.

---

_This is a living document. When something here is settled, replace the language with what was decided. When something here is wrong, change it and note the date. The §0 pivot notice is the most important thing in this document — if a future change re-opens any of those decisions, lead with updating §0._
