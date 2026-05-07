# Vylux — Product Requirements Document

> **Status:** Draft v4 (esport pivot — mechanical-mastery pillar + competitive surface fleshed out). Supersedes the prototype-era PRD.
> **Owner:** Jaco
> **Last updated:** 2026-05-07 (Phase 3.0–3.10 implemented; 3.11 next)

---

## 1. Vision

Vylux is a **fast, legible, deeply competitive 1v1 real-time strategy game** wrapped in a Tron-inspired neon-on-charcoal aesthetic. The bet is simple: _readability + depth + a tight, deterministic simulation_ create the conditions for an esport. Tron-minimal art is a competitive feature, not a budget compromise — high-contrast silhouettes are easier to read at a glance for both players and spectators than fidelity-heavy art (cf. StarCraft: Brood War, AoE2).

The product target is **Steam release with a credible competitive scene**. Vylux is not trying to out-content StarCraft 2 or AoE4 on production value. It is trying to be the RTS that is **easy to spectate, hard to master, and impossible to desync**.

## 2. North-star outcomes

In rough priority order, success at the end of the phase plan in §8 looks like:

1. **A 1v1 ranked ladder** with a healthy queue and a working matchmaking signal (Glicko-2 or similar). Concrete thresholds (concurrent queue at peak, retention week-over-week) are TBD — to be set once the closed alpha in Phase 2 tells us what the cohort actually looks like.
2. **Replays and live spectating** that work end-to-end — every ranked match is replayable, watchable, and shareable as a single artifact.
3. **At least one community-run tournament** has happened on the shipped client without us building bespoke infrastructure for it.
4. **An AI opponent that is a useful sparring partner** at low–mid ladder skill (not a marketing AI, a training tool).
5. **A Steam release** (Early Access acceptable) with the above, on Windows + macOS, with a Linux build as a stretch.

This horizon is **multi-quarter, not twelve months**. The phase plan in §8 is sequenced — Phase N+1 begins when N's exit criteria are met — and rushing it is the failure mode, not slipping it.

That said, "multi-quarter" should not become a hiding place. The only phases close enough to estimate are 0 and 1: **Phase 0 + Phase 1 are expected to land inside ~2 quarters of focused work**. If they don't, the right move is to re-evaluate the engine/sim-language choice (per §3.1) rather than push harder on a path that isn't converging.

Things that are explicitly **not** north-star outcomes: campaign content, single-player narrative, mobile/touch, console parity, microtransactions.

## 3. Pillars (load-bearing design constraints)

These are the constraints every feature must answer to. If something violates a pillar, it does not ship — even if the prototype already had it.

### 3.1 Deterministic simulation

The simulation is **frame-rate independent, integer-or-fixed-point, seeded, and bitwise reproducible** across machines and OSes. Same inputs in, same state out, every time. This is the gate for everything else: lockstep multiplayer, replays, spectating, anti-cheat, balance feedback. Floating-point trig and `requestAnimationFrame`-driven updates are forbidden inside the sim.

### 3.2 Lockstep netcode

1v1 ranked matches use **deterministic lockstep over a low-latency transport** (WebRTC datachannels by default, websockets as fallback). Inputs are commands, not state. The server (or peer) relays input frames; both clients run the same simulation. Bandwidth target: ~1–2 KB/s typical. Latency budget: playable up to ~150 ms RTT.

### 3.3 Render/sim separation

Rendering is a **read-only consumer** of sim state. The sim ticks at a fixed rate (target 20 Hz, possibly 30); the renderer interpolates between sim states and never writes back. This is what makes determinism survive the move to a real game with animations, juice, and graphical settings.

### 3.4 Replays as first-class artifacts

A replay is the input log + the seed + the version. Every match produces one. The same binary that plays the game plays the replay. No separate replay path, no "best effort" sync.

### 3.5 Readability over fidelity

Tron neon-on-charcoal, high-contrast silhouettes, readable at 720p on a Twitch stream. **No** post-process bloom that washes out unit edges. **No** unit designs that read identically at small scale. Spectator legibility is a P0 concern, not a polish item.

### 3.6 Depth via asymmetry, not breadth

Two factions at launch with **meaningfully different macros** (build orders, economy curves, win conditions) beat six factions with cosmetic differences. AoE2 longevity comes from the asymmetric civ space; we get one shot at this and we'd rather have a tight counter-triangle that holds up under top-level play than a wide roster that doesn't.

### 3.7 Anti-cheat by construction

Lockstep determinism gives us strong anti-cheat almost for free: every client simulates everything from the same seed and inputs, so a desync is either a bug or a tampered client. There is no server-authoritative state to lie to and no fog-of-war to peek behind in the network layer (every client already has the full state). Map-hacks, stat edits, and damage hacks are detectable as desyncs against the canonical hash; a separate cheat-detection system is not the first line of defence, the simulation is. This is a competitive feature, not just a technical detail.

**What lockstep does _not_ catch:** input automation (auto-clickers, build-order macros, APM bots) and read-only client snooping (renderer-layer overlays that surface stats, peek at off-screen units, or expose information the player shouldn't yet see). Both produce valid input streams and identical sim state — they're invisible to the desync check. Those need separate measures (input cadence heuristics, client integrity, conservative information exposure in the renderer). Calling out the boundary now so the pillar isn't oversold later.

### 3.8 Mechanical mastery is a first-class skill axis

A competitive RTS lives or dies on the gap between what a player _intends_ and what they can _execute_. That gap is closed through **deliberate practice of a deep control scheme** — hotkeys, control groups, camera bookmarks, queued commands, production-from-anywhere. AoE2, StarCraft, Brood War: the top of every ladder is built on muscle memory, not on having read the patch notes more carefully than the bronze player.

Vylux is **keyboard-first for competitive play**. The mouse is fine for onboarding, scouting, and unit selection, but every action that affects the simulation must have a keyboard path that is _faster_ than the mouse path. A player who never touches the mouse during economic/production phases must remain fully competitive. This is the difference between a strategy game and an _esport_.

Concretely, this pillar commits us to:

- **Full keyboard parity.** Every command available via mouse is also available via key. No "advanced controls" lurking in menus only — they are the supported path.
- **User-customisable bindings.** Players bring their own hand shapes, claw grips, and muscle memory from other RTSes. Defaults ship sensible (grid + AoE-style), but the binding layer is user-rebindable end-to-end.
- **Control groups.** `Ctrl+1..9` to bind, `1..9` to recall, `Shift+1..9` to add. A double-tap on a control-group key centres camera on it. This is table stakes for the genre.
- **Camera bookmarks.** Independent of control groups. Snap to base, snap to forward army, snap to last alert.
- **Production from anywhere.** Training a unit, queuing a building, or upgrading does not require the camera to be over the producing structure. The player drives macro from any view.
- **Queueing as a primitive.** Shift-modifier queues every order — move, attack, build, gather, train. Queue depth is generous; the sim is deterministic so queue replay is free.
- **Idle-worker / find-army hotkeys.** A single key cycles idle workers; another cycles combat groups. These are the difference between a 30 APM game and a 120 APM game without changing the design.
- **Smart-cast on abilities.** When abilities exist, the default is target-where-the-cursor-is, no second click required. Held-shift opts into the legacy "click target" form for precision.
- **No hidden APM tax.** UI patterns that exist only to consume APM (e.g. mandatory rally re-clicks, manual worker assignment loops) are anti-features. APM should be spent on _decisions_, not on overcoming the UI.

Mechanical mastery and macro decision-making are not in tension here — both are rewarded. The §6.1 pacing line ("a thoughtful player at moderate APM should beat a faster player making worse choices") still holds. What this pillar adds is the **upper bound**: at the top of the ladder, two thoughtful players are separated by execution speed, and the control scheme has to give them somewhere to go.

## 4. Players we are designing for

Three personas. Features get prioritized by which persona they unlock.

| Persona | Skill | What they need | When we serve them |
|---|---|---|---|
| **Ladder Climber** | Mid–high | Fast queues, fair matchmaking, replays of their losses, balanced patches | Phase 2 onward (post-determinism) |
| **Aspiring Pro** | High | API access for tools, observer mode, tournament-grade stability, replay parsing | Phase 4 |
| **Curious Tourist** | New | A 30-minute path from "what is this" to a finished match, an AI that doesn't humiliate them | Phase 1 onward |

The casual player who wants a 5-minute coffee match is **welcome but not optimised for**. We are not chasing the mass-market RTS player; we are chasing the player who wants to get _good_.

## 5. Scope — in and out

### In scope (target Steam launch)

- 1v1 ranked + unranked
- 2 factions with asymmetric units, structures, and economy
- 4–6 hand-tuned competitive maps
- Deterministic lockstep multiplayer (peer-to-peer with relay fallback)
- Replays (record, play back, scrub, share)
- Live spectator mode (delayed observer, not just post-game)
- Glicko-2-style ranked ladder with seasons
- AI opponent at 3–4 difficulty tiers (sparring partner, not a campaign foe)
- Steam integration: cloud saves (settings + replays), achievements, friend invites
- Windows + macOS clients (Tauri or Electron wrapper around the existing web build)

### Out of scope (explicitly deferred)

- Single-player campaign
- 2v2 / FFA / team modes
- Mod tooling or custom maps
- Console / mobile / touch
- Microtransactions, battle passes, cosmetic store
- Voice chat, in-game social graph beyond Steam friends
- Cross-progression with non-Steam stores

### Out of scope (forever, unless re-pitched)

- Pay-to-win mechanics
- Loot boxes, gacha, or any RNG monetisation
- Asymmetric paid faction unlocks (factions are gameplay, not DLC)

## 6. The match — competitive surface

This section is opinionated. It commits to the **shape** of a competitive match — what systems exist, what they do, how they interact. Concrete numbers (HP, damage, costs, gather rates, tick budgets) are deliberately deferred to design docs that come during Phase 1 and 3. What matters here is that the surface is wide enough to support build-order branching, scouting, comebacks, and spectator narrative — and narrow enough that a small team can ship it.

> **Current catalog of what's actually in the game** (units, structures, resources, tech, controls, the launch map): see [`docs/manual.md`](../manual.md). This PRD describes the design intent; the manual describes the current shipped state. They diverge by design — the PRD is forward-looking, the manual is current. When a sub-phase ships a change, the manual updates with it; the PRD updates only when the design intent itself shifts.

The current prototype's "race to 500 points across nodes/kills/HQ damage" is **not** assumed to survive. The shape below is what we are building toward.

### 6.1 Length & pacing

- **Length target:** median 8–14 minutes. Long enough for macro decisions, short enough for a Bo5 in under 90 minutes.
- **Pacing:** rewards macro decision-making over raw APM. A thoughtful player at moderate APM should be able to beat a faster player making worse choices, while two equally-thoughtful players at the top of the ladder are separated by execution speed (per §3.8). How we measure pacing is TBD — playtest-driven, not a hard metric.
- **Hard timer:** matches must end inside ~25 minutes. Stalemates kill esports. The game itself produces escalating pressure (see §6.7), but a hard timer with a tiebreaker rule exists as an absolute backstop.

### 6.2 Information model — fog of war

Vylux ships with **partial fog of war**. The terrain (the grid itself, energy nodes' positions) is visible to both players from the start; **enemy units and structures are hidden** until they enter friendly vision. Vision is provided by units (each has a vision radius) and by structures (HQ + production buildings provide larger but stationary vision).

- **Why partial, not full:** the Tron neon palette is a readability asset; black-fogged terrain on top of dark-charcoal grid would fight that. Terrain-always / entities-fogged keeps the map readable while preserving scouting depth.
- **Sim has full state, renderer enforces.** The deterministic sim sees everything (per §3.1); the renderer filters what each player sees. This keeps lockstep clean while still giving players genuine information asymmetry.
- **No fog-cheats in the network layer** (per §3.7), but the renderer must be conservative — see the §3.7 caveat about read-only snooping. Anything the renderer can show, a modded client can read. Information that must remain hidden (enemy build order, exact army composition) is _gated by what the sim sends to the renderer_, not just by what the renderer chooses to draw.
- **Scouting is a real action.** Sending a worker, a fast scout unit, or sacrificing a frontline unit to peek is part of macro play. The faction asymmetry (per §3.6) includes asymmetric scouting tools.

### 6.3 Economy & resources

**Two resources.** One primary, one advanced.

- **Primary resource ("Energy"):** the workhorse. Gathered from energy nodes scattered around the map. Used for workers, basic structures, and tier-1 units. Plentiful, decentralised, and the natural target for early-game expansion.
- **Advanced resource (working name "Flux"):** scarce and contested. Gathered from a small number of high-value nodes near the map centre or other contested zones. Required for tier-2 production, advanced units, and tech upgrades. The player who controls Flux has options the other player doesn't.

Why two resources, not one or three:

- **One** (the prototype's energy) flattens build orders into a single income curve. Every faction plays the same way: maximise income, dump into army.
- **Three** is AoE/SC2 territory and adds complexity without proportional depth at our scope.
- **Two** gives the build-order branching needed for "do I rush, do I expand to Flux, do I tech?" without ballooning the spreadsheet.

Workers gather, deposit, and repair. They are not auto-harvesters in the strict sense — assignment matters and idle workers are a real problem (per §3.8 idle-worker hotkey). But the model is deposit-based (gather → return to nearest dropoff), not the prototype's "stand-on-node-and-multiply-income" model. The prototype model is too passive for a game where map control _means something_.

> _Implementation status (Phase 3.10):_ workers are the builders too — `BuildStructureByWorker` dispatches a selected worker to walk to a tile and construct the structure (Forge / Spire / Pylon); multiple workers stack throughput. Auto-assign on spawn was removed in 3.9.2 so the player keeps agency over where workers go; the §3.8 idle-worker hotkey is the long-term answer to surfacing them. "Repair" itself is not yet wired — that lands when structures can take damage outside of HQ-attack scenarios.

### 6.4 Tech & production

Production is **building-gated, not HQ-only**. The prototype's "click HQ to train anything" does not survive — it removes a critical decision (where on the map to commit production capacity) and flattens the tech tree.

- **HQ** trains workers and provides base economy. Cannot train combat units past tier-0.
- **Production buildings** (faction-asymmetric: e.g. a "Forge" for one faction, a "Pulse Hub" for the other) train combat units. Each production building has its own queue and rally point.
- **Tech tiers** gate access. Tier 1 from the start, Tier 2 unlocked by an upgrade structure or research, Tier 3 (if it exists) gated behind Flux + tier-2 prerequisites.
- **Faction-asymmetric tech trees.** Per §3.6, the two factions don't have the same building list with reskinned units. Their tech progressions branch differently — one might have early-tier siege, the other late-tier mobility. This is where most of the strategic depth lives.

### 6.5 Counter structure — units & roles

Three role primitives every faction fields, plus tech-tier counters layered on top:

- **Eco** — workers. Cheap, no combat, gathers resources.
- **Frontline** — high HP, low DPS, soaks damage. Holds ground.
- **Harass** — low HP, fast, high DPS to fragile targets. Punishes greedy economies and misplaced armies.
- **(emerging via tech)** Specialist roles — siege, support, anti-frontline — unlocked at tier 2+.

Every unit has a clear strong-against and weak-against, published in-game (no datamining required). The counter triangle exists at two levels:

- **Within tier:** frontline counters harass, harass counters eco/light, eco runs from everything. Standard rock-paper-scissors.
- **Across tiers:** higher-tier units beat their lower-tier equivalents but cost more time and Flux. A successful early aggression can deny a tech opponent before they realise tier 2.

Faction asymmetry shows up in **what fills each role**, not in removing roles. Both factions have a frontline; their frontlines play differently (one slow-and-tanky, one fast-and-self-healing, etc.).

### 6.6 Map model

- **Tile-based, isometric.** The grid stays. We do not add height/elevation in launch scope (see §5).
- **Asymmetric maps.** Each map has identifiable features: choke points, vision blockers (low-vis terrain), Flux nodes near the centre or at contested expansions, and at least one "third base" position that is geographically committal to take.
- **No high ground.** Tile-only terrain. Vision blockers exist (terrain types that obstruct line-of-sight without blocking pathing) but elevation does not. Adding elevation correctly is expensive — it can come post-launch if the meta begs for it.
- **Map shape changes the matchup.** A map with a tight central choke favours the frontline-heavy faction; an open map with multiple flanks favours the harass-heavy faction. We measure this in playtest, and we accept that some matchups will be map-favoured — that's a feature, not a bug, as long as no _faction_ is universally map-favoured.
- **4–6 launch maps.** Hand-tuned. No procedural generation, no random map pools, in launch scope.

### 6.7 Win & loss conditions

At least **two viable victory paths per faction**. Default set:

1. **Military elimination.** Destroy the enemy HQ + all enemy production buildings. Killing the HQ alone is _not_ enough — production must also be denied, otherwise the loser turtle-rebuilds endlessly.
2. **Map control / economic dominance.** Sustained control of a majority of Flux nodes for a duration accumulates "dominance ticks" toward a victory threshold. The losing player can break this by reclaiming Flux. This gives a non-military path to victory and rewards positional play.
3. **(Optional, faction-specific) Tech objective.** Some factions may have a "complete the megastructure / final research / superweapon" path that takes long but is harder to interdict than military elimination. Treat this as a stretch, not a launch commitment.

Loss conditions:

- All HQs destroyed and all production destroyed → defeat.
- Opponent meets a victory threshold → defeat.
- Hard 25-minute timer expires → tiebreaker by score (Flux controlled, units killed, structures destroyed). The hard timer should rarely fire; it exists so a stalled match can never grief a tournament bracket.
- **Resign is a first-class action** with a confirmation. Replays are saved on resign too.

### 6.8 Comeback & end-game pressure

Pressure compounds; comebacks exist but are earned.

- **Map control creates pressure.** As one player accumulates Flux control, their dominance-tick rate rises. The losing player feels the clock harder than the leading player. This is what prevents turtle-stalemates.
- **Comebacks come from positional play, not free mechanics.** The losing player can re-take a Flux node, harass the leader's economy, or break a siege — all of which slow the dominance clock. There is no "comeback button" (no rubber-band damage buffs, no free units when behind). RTS comebacks should feel earned by reading the game, not gifted by the system.
- **A 2-minute lead is meaningful but not decisive.** If you are 2 minutes ahead in tech, the game is yours to lose, not won. If you are 2 minutes ahead and your opponent has already taken 60% of map control, you are not actually ahead.
- **Late-game is _unstable_, not _stuck_.** The 25-minute hard timer is the safety net; the dominance clock is the pressure mechanism. Together they ensure that "deathball-meets-deathball-and-stares" is not a viable strategy.

### 6.9 Control & input

Concrete commitments arising from §3.8 — what the input surface looks like in the shipped client:

- **Keyboard parity** for every sim-affecting command. No mouse-only paths.
- **Customisable bindings** end-to-end. A binding-config UI; bindings persist via Steam Cloud.
- **Control groups** `Ctrl+1..9` bind, `1..9` recall, `Shift+1..9` add, double-tap centres camera.
- **Camera bookmarks** (separate from control groups), bound to F-keys by default.
- **Production hotkeys** addressable by building category (e.g. one key cycles your Forges).
- **Idle-worker hotkey** (cycle), **find-army hotkey** (cycle), **base hotkey** (snap to HQ).
- **Shift-queueing** for every command type. Queue is replayed deterministically by the sim.
- **Smart-cast** on abilities; held-shift opts into precise targeting.
- **Mouse remains supported** end-to-end; a new player can play, learn, and win matches with mouse-only. The keyboard layer is what they grow into, not a wall they hit.

## 7. Technical North Star

| Concern | Target |
|---|---|
| Sim tick rate | 20 Hz (configurable, must support 30) |
| Sim → render | Pull-only; renderer interpolates, never writes |
| Determinism | Bitwise reproducible across Win/macOS, same architecture |
| Numeric model | Fixed-point (Q16.16 or similar) for any value affecting state |
| RNG | Single seeded PRNG per match; no `Math.random()` in sim |
| Net model | Lockstep, input-frame relay, ~6 frame input delay |
| Bandwidth | <2 KB/s sustained per client in a 1v1 |
| Replay format | `{ version, seed, faction_picks, map, input_frames[] }` |
| Renderer | Three.js (committed); orthographic isometric camera; Vite build; TypeScript strict |
| Sim layer | TBD — Phase 0 decides between TypeScript-with-fixed-point and Rust→WASM. Three.js stays either way. |
| Distribution | Tauri or Electron Steam build; web build remains for dev/marketing |

## 8. Phases

This is a working sequence, not a Gantt chart. Phase N+1 begins when N's exit criteria are met.

**Phase 0 — Determinism Spike (now)**
See `docs/investigation/00-determinism-and-netcode.md`. Exit criteria: two browser tabs run a scripted match and produce bit-identical state hashes for 10 minutes; a replay file replays back to the same hashes; a recorded match desync is detectable within one tick.

**Phase 1 — Sim Rewrite**
Port the prototype's gameplay (HQ, workers, energy, three units) onto the new deterministic sim. No new features, just the same game on the new spine. Exit: prototype-equivalent gameplay against a placeholder AI, replays work, ranked-quality determinism proven offline.

**Phase 2 — Multiplayer Alpha**
Lockstep over WebRTC, relay server for NAT, basic lobby. Closed alpha with ~20 invited players. Exit: 100 ranked-quality 1v1 matches played end-to-end without desync; observer mode prototype working.

**Phase 3 — Faction & Map Depth**
Second faction, 4–6 launch maps, the counter-triangle redesign. This is where the game stops being a prototype-rewrite and starts being _Vylux_. Exit: internal playtests show no obviously dominant strategy or faction at tester skill — both factions are viable, both have win conditions, and at least two distinct build orders feel competitive on each map. Tight winrate tuning (±5%) is a live-service problem, not a gate.

**Phase 4 — Steam Early Access**
Steamworks SDK, Tauri/Electron wrapper, cloud saves, achievements, store page, friend invites, Glicko-2 ladder, seasons. Exit: green-light for paid Early Access launch.

**Phase 5 — Ladder & Esport Hooks**
Replay sharing, live spectator delay, observer API, tournament-mode lobby, broadcast overlay support. This is the phase that makes a community tournament _possible_ without us running it.

## 9. Risks — ranked

1. **Determinism is harder than expected.** JavaScript / TypeScript is not a friendly language for bitwise-reproducible math. Mitigation: Phase 0 spike answers this before we build anything else. If it fails, we re-evaluate the engine choice (Rust→WASM sim is the leading alternative).
2. **The RTS market is crowded.** SC2, AoE2:DE, AoE4, Stormgate, Battle Aces. Mitigation: don't compete on production value; compete on _reproducibility, replays, and spectator legibility_. Be the RTS the streamers can broadcast cleanly.
3. **AI quality bottleneck.** A weak AI hurts onboarding more than it hurts esport. Mitigation: scope the AI as a deterministic scripted opponent first, ML-based later (or never).
4. **Lockstep latency.** Anything above ~150 ms RTT feels bad in lockstep. Mitigation: input delay tuning, regional matchmaking, relay servers in NA/EU/OCE/AS.
5. **Solo dev throughput.** This roadmap is multi-quarter for a small team. Mitigation: ruthless scope discipline, the "Out of scope forever" list is real.

## 10. Non-goals (what this PRD does not commit to)

- A specific art style beyond "Tron-inspired neon-on-charcoal."
- A specific language/runtime for the simulation layer (Phase 0 informs this — the renderer is Three.js regardless).
- A specific multiplayer transport (WebRTC is the default, not a contract).
- A launch date.
- A revenue model beyond "paid Early Access on Steam."

These will be settled by the investigations and phase exits referenced above.

## 11. What survives from the prototype

The repo currently contains a working prototype: HQ, workers, energy nodes, raiders, defenders, combat, scripted AI, training, points/win-condition, and a placement state machine on a Tron-grid scene. Phase 1 is a **rewrite of the simulation layer onto a deterministic spine** — not a refactor in place. The list below is what carries across that boundary.

**Carries over (concept, may be re-implemented):**

- The **game shape** — HQ, worker economy, energy nodes, asymmetric military units, points-based win condition. This proved out in playtest and is the starting point for §6.
- The **art direction** — orthographic isometric camera, charcoal background, Tron neon contrast (red-orange vs. blue), high-contrast unit silhouettes. This is the §3.5 readability pillar made concrete.
- The **module discipline** — strict separation of pure state (`placement.ts`-style), thin input dispatchers, and read-only renderer reconciliation. The pattern is the right shape for §3.3 (render/sim separation); the new sim core _aims to inherit_ it with stricter boundaries, but that's a goal to verify in Phase 1, not an established contract.
- The **playtest learnings** — what felt bad in the prototype is real signal even when the numbers behind it are cut. Known hot spots from the prototype review cycles (raider damage curve relative to worker survival, HP-bar contrast against the dark grid, spawn-point ergonomics, one-per-node occupancy under load, AI worker parity with the player loop, energy-node regeneration) carry forward as **things we already know to watch**. The numeric tuning starts fresh; the questions don't.
- The **test discipline** — Vitest for pure logic, Playwright for end-to-end, the single `npx tsc --noEmit && npm run test && npm run test:e2e` gate, the `source-scan` checks against silent-pass error handling. Same standard, expanded to cover determinism hashes.

**Does not carry over (cut, or rebuilt from scratch):**

- All current sim code that uses `Math.random()`, `Date.now()`, `requestAnimationFrame`-coupled state, or floating-point math affecting state. Replaced by seeded PRNG + fixed-point + tick-driven sim per §3.1 and §7.
- The current scripted AI. A new deterministic AI is built on the new sim; the old one is reference behaviour, not code we keep.
- The "race to 500 points" win condition as a literal rule. The _shape_ (multiple paths to victory) is preserved; the numbers and structure are reset per §6.7.
- Any prototype-era balance numbers (HP, damage, costs, ranges). They informed playtest but are not load-bearing — Phase 1 re-tunes against the new tick rate and fixed-point model.
- The single-map / single-resource / no-fog assumptions. Phase 3 introduces 4–6 maps, two resources (per §6.3), and partial fog of war (per §6.2). All three are deliberate departures from the prototype, not regressions.
- The HQ-only training model. Per §6.4, production is building-gated, not centralised on the HQ.
- The mouse-only input surface. Per §3.8 and §6.9, keyboard parity is a launch requirement; mouse-only was a prototype simplification, not a design choice that survives.
- The "stand on a node and multiply income" harvesting model. Per §6.3, the deposit-based gather/return loop replaces it — passive harvesting flattens map control into a non-decision.

**Open questions inherited from the prototype** (these need answers before or during Phase 1, not before this PRD ships):

- Does the worker-harvest-pulse model survive deterministic ticks, or does it become event-driven?
- Is "energy node" the right primitive, or do we want a different resource-shape now that the sim is built for it?
- The defender/raider/worker counter-triangle — does it hold up as one of two factions, or does the second faction need a different unit roster entirely?

---

_This is a living document. When something here is settled, replace the language with what was decided. When something here is wrong, change it and note the date._
