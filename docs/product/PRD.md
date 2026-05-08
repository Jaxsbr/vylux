# Vylux — Product Requirements Document

> **Status:** Draft v5 (PvE pivot — single-player RTS PvAI with Rogue environmental pressure; competitive 1v1 / esport ambitions retired). Supersedes v4 (esport pivot) and the prototype-era PRD.
> **Owner:** Jaco
> **Last updated:** 2026-05-08 (PvE-shape refinement on the 2026-05-07 pivot: RTS PvAI duel + Rogue mob spawns, replacing the wave-defense framing; 3.11 split into 3.11a/3.11b)

---

## 0. Pivot notice (read this first)

Vylux was originally pitched as a **competitive 1v1 RTS aimed at Steam release with a credible esport footprint**. Phases 0, 1, 2 and sub-phases 3.0–3.10 were built against that target. As of 2026-05-07 the direction has changed:

- **Vylux is now a single-player Tron-grid RTS**, structured as **player-vs-AI skirmish on a deterministic sim**, with **Rogue environmental mob spawns** layering continuous neutral-hostile pressure on both sides over the course of a match.
- **Both factions are playable.** The player picks **Pulse (Swarm)** or **Forge (Siege)** on the main menu; the AI plays the **opposing** faction. The asymmetry is genuine — Pulse is fast / fragile / many; Forge is slow / heavy / few. They share UI architecture but nothing else (roster, voice, colour, motion personality all diverge).
- **Win condition: destroy the enemy AI faction's HQ.** Loss: own HQ destroyed, or resign. Rogues are *not* a win/lose target — they are environmental pressure that compresses the time both sides have to out-RTS each other.
- The **deterministic sim, the Tron aesthetic, the catalog (workers / forge / spire / pylon / fog / supply / colour resource / action bar), the AI scaffolding, and the renderer** all carry across the pivot unchanged. The pivot is a *design* shift, not a technical rewrite.
- The **lockstep / WebRTC / observer multiplayer code** under `src/net/` is **dormant**: preserved for optionality (so we don't pay to delete and rebuild), but **not on the active surface**. No new esport / ladder / spectator / matchmaking work happens without a fresh pivot conversation.
- The **mechanical-mastery / keyboard-first pillar** (formerly §3.8) is **softened, not retired**: good keyboard control still matters, but full rebindable parity is no longer a launch-blocking commitment. Hotkeys for common actions stay.
- The **Phase 8 plan is replanned** for Phases 4 and 5 (meta-progression around the PvAI run, then content + optional Steam release). Phases 0–3 remain accurate as a historical record of how we got here; the closed sub-phases (0.x, 1.x, 2.x, 3.0–3.10) are not re-litigated.

> **2026-05-08 — refinement on the pivot.** The 2026-05-07 pivot landed as "single-player PvE wave-defense + roguelike runs." The 2026-05-08 refinement narrows that toward **RTS PvAI + Rogue mob spawns**: the *RTS soul* of the game survives (you still beat an opposing faction to win), and Rogues replace the "scheduled enemy waves" framing as the source of run-pressure. The roguelike-run / between-wave-tech-pick shape is **deferred to Phase 4** rather than landing as part of Phase 3; Phase 3 ships the PvAI skirmish + Rogue environmental layer, and Phase 4 layers meta-progression on top. Sub-phase 3.11 is split into **3.11a** (faction identity & menu — player-pickable, themed UI, persisted choice) and **3.11b** (opposing AI faction + skirmish PvAI win condition).

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

Two **playable factions** at launch — **Pulse (Swarm)** and **Forge (Siege)** — with **meaningfully different macros** (build-order pressure, unit composition, threat profile). The player picks one on the main menu; the AI plays the opposing faction. The asymmetry is genuine — Pulse is fast / fragile / many; Forge is slow / heavy / few. They share **UI architecture** (HUD layout, action bar, build cards) but nothing else: distinct rosters, distinct visual language (cyan vs red, thin/sharp vs heavy/blocky), distinct copy voice (plural-electric vs singular-weighted), distinct AI personalities. They are **not** "the same faction in different colours."

Layered on top of the duel: **Rogue mob spawns** — environmental, neutral-hostile, attacks both sides equally. Rogues create the "scary moments in a run" that earlier framings put on enemy waves; here they emerge from continuous pressure rather than a scheduled curve.

Six factions with cosmetic differences would beat two real ones; we have two real ones. A third *playable* faction is a Phase 5+ stretch.

### 3.6 Match pacing is the design centre

The single most important design lens, and the one most different from v4. A Vylux match is built around a **PvAI duel under continuous Rogue pressure**: both sides build economy, expand, engage, and try to land the killing blow on the other's HQ before Rogue attrition makes the position untenable. Specifically:

- **Opening** (~2–4 min): worker economy, first defensive structures, scout the map. Light Rogue pressure — enough to teach Rogue behaviour without punishing.
- **Mid-game**: Rogue spawns intensify; both Player and AI must commit forces to defending while still pressing for map control. Tier-2 research is a real timing decision.
- **Late-game**: Rogue pressure compresses the safe-turtling window. The match resolves in a window where one side commits to an HQ push or attrition forces a mistake.
- **Resolution**: one HQ falls. No hard timer; no dominance tick.

The run is paced so a player who is paying attention can read both the AI's macro and the Rogue spawn cadence; a player who isn't makes mistakes that compound. The pacing curve, not the unit balance, is the load-bearing tuning surface.

Roguelike between-match meta-progression (unlocks across runs) is layered in **Phase 4**. Between-*match* tech-pick screens are not a Phase 3 commitment.

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
| **Curious Tourist** | A playable web build, a 5-minute "what is this" path, a scenario that doesn't require tutorialisation to enjoy. | Phase 3.11b onward (skirmish win condition lands an honest first match; 3.13 adds Rogue pressure). |

The **competitive ladder player and aspiring pro are not in scope** — that was the v4 audience. They're welcome to play but the game isn't tuned for them.

## 5. Scope — in and out

### In scope (target launch shape, web build first)

- **Single-player PvAI skirmish.** Player vs scripted enemy AI on the deterministic sim. Win = destroy enemy HQ; lose = own HQ destroyed or resign.
- **Two playable factions at launch.** **Pulse (Swarm)** — fast / fragile / many. **Forge (Siege)** — slow / heavy / few. The player picks one on the main menu; the AI plays the opposing faction. Choice persists across visits.
- **Rogue environmental mob spawns.** Continuous neutral-hostile spawns that pressure both Player and AI from neutral spawn points. **Not a third faction** — no Rogue HQ, no "kill all Rogues" win condition. Rogues exist to compress the time both sides have to out-RTS each other.
- **Roguelike meta-progression on top of the run.** Between-run unlocks (new tech options, new scenarios, new starting conditions). Between-*match* tech-pick screens are deferred to Phase 4 — they are not a Phase 3 commitment.
- **3–6 hand-tuned scenarios.** Open arena, bottleneck, three-flux, asymmetric defender, plus 1–2 stretch (gauntlet, boss).
- **Meta-progression.** Persistent unlocks across runs (new tech options, new scenarios, new starting conditions). Not pay-to-progress; just "play more, see more." Lands in Phase 4.
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

## 6. The match — PvAI surface

This section is opinionated. It commits to the **shape** of a match — what systems exist, what they do, how they interact. Concrete numbers (HP, damage, costs, gather rates, tick budgets, Rogue spawn cadences) are deferred to design docs that come during sub-phases 3.11–3.14 and Phase 4.

> **Current catalog of what's actually in the game** (units, structures, resources, tech, controls, the launch map): see [`docs/manual.md`](../manual.md). This PRD describes the design intent; the manual describes the current shipped state. They diverge by design — the PRD is forward-looking, the manual is current. When a sub-phase ships a change, the manual updates with it; the PRD updates only when the design intent itself shifts.

The current build's "race to 100 points or HQ destruction" is **not** the match shape. The 100-point race is a holdover from when this was a competitive 1v1 game; sub-phase 3.11b drops it and ships destroy-enemy-HQ as the working win condition. Sub-phase 3.13 layers Rogue mob spawns on top.

### 6.1 Length & pacing

- **Match length target:** 12–20 minutes for a hard-fought match; 5–15 for a one-sided one. Long enough for tier-2 tech decisions, short enough that "one more match" is a tractable ask.
- **Rogue spawn cadence:** Rogue mobs spawn on a deterministic schedule that pressures both sides equally. Cadence intensifies over the course of a match — early Rogues are a teaching nuisance, late Rogues are a real threat to an under-defended position.
- **Pacing rewards reading both the AI and the Rogues.** A player who scouts the AI's tech choices, watches Rogue spawn directions, and re-positions accordingly outperforms a player who plays the same opener every time. Pacing is **playtest-driven**, not a hard metric.
- **No hard timer.** v4 had a 25-minute timer to prevent esport stalemates; the PvAI + Rogue model has no such concern (Rogue pressure makes infinite turtling untenable). The match ends when one HQ falls, the player resigns, or the player quits.

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

In PvAI + Rogue, **harasser pressure on your harvesters** is a primary failure mode — both AI raiders and Rogue mobs target undefended workers. A player who doesn't garrison the right nodes loses their economy mid-fight.

### 6.4 Tech & production _(unchanged from v4 §6.4)_

Production is **building-gated, not HQ-only**:
- **HQ** trains workers and provides base economy.
- **Production buildings** (Forge for combat units, Spire for research, Pylon for supply) — already shipped in Phase 3.0–3.10.
- **Tech tiers**: Tier 1 from the start, Tier 2 unlocked at the Spire.

In PvAI + Rogue, tier-2 research is a **strategic timing decision**: spend 80 ticks researching now and you're vulnerable to whichever Rogue spawn or AI push lands at tick T+80; delay and you fight the next pressure window with tier-1 only.

### 6.5 Counter structure — units & roles _(largely unchanged from v4 §6.5)_

Three role primitives both factions field, plus tech-tier counters:
- **Eco** — workers (both factions; harvesters drive the economy).
- **Frontline** — high HP, holds choke points.
- **Harass** — low HP, fast, punishes scattered economy.
- **Specialist** (tier 2+) — siege, anti-frontline, support.

The counter triangle still applies: frontline counters harass, harass counters eco, eco runs from everything. The PvAI twist: **the AI's faction commits it to a known shape** — a Pulse AI is going to bring harass-and-pressure; a Forge AI is going to bring slow-heavy push. Reading the matchup and building counters is the core strategic loop. Rogues add a *third axis*: their composition tilts toward a specific role each spawn (a Rogue harass-cluster punishes turtles that ignored mobile defense; a Rogue siege-cluster punishes positions without anti-armour) — so even a player who has read the AI correctly still has to react to Rogue cadence.

### 6.6 Map / scenario model

- **Tile-based, isometric.** The grid stays. No height/elevation in launch scope.
- **Scenarios as data.** A scenario is `(map_layout, starting_resources, ai_faction, rogue_schedule, win_condition, seed)` — all data, not code. Sub-phase 3.12 lifts this out of `main.ts`'s hardcoded SPEC.
- **Hand-tuned + seeded.** Map layouts are hand-tuned; per-run variation comes from **seed-driven Rogue spawn composition + AI build-order rolls**, not procedural map generation.
- **3–6 launch scenarios** with distinct shapes:
  - **Open arena** — symmetric, no choke. Tests army composition and direct PvAI engagement.
  - **Bottleneck** — central choke. Frontline-favoured; Rogues spawn from neutral edges and force commitments away from the choke.
  - **Three-flux** — three contested Flux nodes. Tests map-control decisions; Rogues contest the third Flux.
  - **Gauntlet** (stretch) — narrowing arena, Rogues push both sides toward each other.
  - **Boss** (stretch) — a single Rogue boss-mob spawns mid-match with a designed mechanic. Both Player and AI must contend with it; whoever survives the boss wave with HQ intact is positioned to close the match.

### 6.7 Win & loss conditions

Skirmish PvAI win conditions, replacing both v4's military-elimination-or-dominance set and the 2026-05-07-pivot's survive-N-waves framing:

1. **Destroy the enemy AI faction's HQ.** Primary win condition. Both Player and AI start with one HQ; whoever loses theirs first loses the match. This is the working model for Phase 3 and is preserved into Phase 4.
2. **Complete the scenario objective** (optional, per scenario). Hold a specific node, control a contested Flux for N ticks, escort a structure to a destination. Scenario-defined; layered on top of the HQ-destroy default, not a replacement.

Loss conditions:
- **Own HQ destroyed** → defeat.
- **Resign** is a first-class action (CommandKind slot 13; lands in 3.11b). Replays save on resign.

**Rogues are not a win/lose target.** They spawn continuously, attack both Player and AI equally, and the run is *not* gated on killing them all. There is no Rogue HQ, no "Rogue king," no "kill all Rogues" condition. Rogues exist purely to compress the time both sides have to out-RTS each other and to make turtling expensive.

There is **no hard timer**. There is no "dominance tick." Both were esport scaffolding.

### 6.8 Match-pressure curve _(replaces v4 §6.8)_

Pressure comes from **AI macro + Rogue cadence + resource scarcity**, not from a dominance clock.

- **Rogue spawn intensity scales** non-linearly: early spawns are gentle, mid-match spawns punishing, late spawns require real preparation. The AI faces the same curve.
- **Resource nodes deplete** mid-match. The side that didn't expand early runs out of Energy mid-match. Expansion is a real decision under pressure.
- **AI macro choices compound.** A Forge AI that got its tier-2 research up early plays a different mid-game than one that committed to mass tier-1. Variety across matches comes from the AI's seeded build paths and Rogue composition, not just the map.
- **Comebacks come from positional play and clever Rogue redirection.** A player who lost their main base but holds a forward Forge can claw back if they read Rogue spawn directions correctly and let Rogues attrit the AI. There is no rubber-band buff.

(Roguelike between-*match* tech-pick compounding is a Phase 4 commitment, not a Phase 3 one.)

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

**Phase 3 — Faction & Map Depth** _(active — 3.0–3.10 closed; 3.11–3.14 repointed for the 2026-05-07 pivot, refined 2026-05-08)_
Mechanical depth: structures, two-resource economy, fog, supply, action bar, worker-driven building. The remaining sub-phases pivot toward the RTS-PvAI + Rogue shape:
- 3.11a — faction identity & menu (player picks Pulse/Forge; themed HUD + end-screens; persisted choice; dramatic selector).
- 3.11b — opposing AI faction + skirmish PvAI win condition (AI plays the un-picked faction; destroy-enemy-HQ win; resign command).
- 3.12 — scenarios as data + seedable runs (lifts SPEC out of `main.ts`).
- 3.13 — Rogue environmental mob spawn system (continuous neutral-hostile pressure on both sides; not a third faction; not a win/lose target).
- 3.14 — playtest gate: "is the loop fun" — ≥20 internal matches across both faction-picks; player wants to start another match.

See `docs/investigation/04-phase-3-faction-and-map-depth.md` for sub-phase detail.

**Phase 4 — Run loop & meta-progression**
Roguelike skeleton on top of the PvAI + Rogue match: per-match tech-pick screens, per-run upgrade tree, persistent unlocks across runs. Save / resume. Difficulty tiers per scenario (AI strength + Rogue cadence). AI tuning per difficulty. Exit: a player can complete 5 distinct successful runs across scenarios + difficulties; meta-unlock economy feels worth pursuing in playtest.

**Phase 5 — Content + optional Steam release**
Hand-tune the full launch scenario set (3–6 distinct shapes); polish; tutorial-by-design (the first scenario teaches without a tutorial UI); audio polish; main-menu run-history view. **Optional:** Tauri/Electron wrap for Steam release if and only if the web build has demonstrated organic interest; this is a stretch goal, not a Phase 5 commitment. Exit: launch-ready web build that a player can find, play, and finish without prior context.

**Retired phases (from v4):**
- v4 Phase 4 (Steam Early Access — Steamworks SDK, Glicko-2 ladder, seasons, friend invites). Replaced by current Phase 4 + the Steam-as-stretch in Phase 5.
- v4 Phase 5 (Ladder & Esport Hooks — replay sharing UI, live spectator delay, observer API, tournament-mode lobby, broadcast overlay). **Retired entirely.**

## 9. Risks — ranked

1. **The PvE design isn't fun.** This is the biggest risk by a wide margin. The competitive 1v1 risk was "can we ship it"; the PvE risk is "do people enjoy it once we do." Mitigation: ship a playable run-loop end-to-end fast (sub-phases 3.11–3.13 + a thin Phase 4) and put it in front of real players before authoring 3+ scenarios. If the loop isn't fun at one scenario, no amount of content fixes it.
2. **Scope blowout via meta-progression.** Roguelike unlock trees are bottomless. Mitigation: the launch unlock tree caps at ~20 nodes. Not 200. We commit to that number in Phase 4's investigation doc.
3. **Solo-dev throughput.** Same as v4. Mitigation: the PvE pivot reduces the *required* scope (no ladder, no matchmaking, no spectator) by more than it adds (run-loop + meta + scenario authoring). Net throughput should improve.
4. **Determinism regression during PvE work.** Sub-phases 3.11b–3.13 still touch `SimState` (opposing-faction state, Rogue spawner state, win-condition state). Same mitigation as Phase 3 generally: regenerate fixtures at each sub-phase close, accept mid-flight cross-OS flakiness.
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
