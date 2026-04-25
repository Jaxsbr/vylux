# Vylux — Product Requirements Document

> **Status:** Draft v3 (esport pivot, post-review). Supersedes the prototype-era PRD.
> **Owner:** Jaco
> **Last updated:** 2026-04-26

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

## 6. The match — minimum competitive surface

This section deliberately stays high-level. Concrete numbers (HP, damage, costs, tick rate) live in design docs that come later; what matters here is the **shape** of a competitive match.

- **Length target:** median 8–14 minutes. Long enough for macro decisions, short enough for a Bo5 in under 90 minutes.
- **Pacing:** the game rewards macro decision-making over raw APM. There is a skill ceiling on mechanics, but a thoughtful player at moderate APM should be able to beat a faster player making worse choices. (How we measure this is TBD — likely playtest-driven, not a hard metric in the doc.)
- **Comebacks:** possible but not free. A 2-minute lead should be earned-back, not handed-back by a single mechanic.
- **Win conditions:** at least two viable per faction (e.g. economic dominance vs. military elimination). Avoid a single dominant strategy.
- **Map influence:** maps measurably change build orders. Mirror matchups should still play differently on different maps.

The current prototype's "race to 500 points across nodes/kills/HQ damage" is one possible win condition; it is not assumed to survive the rebuild.

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
- The "race to 500 points" win condition as a literal rule. The _shape_ (multiple paths to victory) is preserved; the numbers and structure are open per §6.
- Any prototype-era balance numbers (HP, damage, costs, ranges). They informed playtest but are not load-bearing — Phase 1 re-tunes against the new tick rate and fixed-point model.
- The single-map assumption. Phase 3 introduces 4–6 maps with measurable map influence on strategy.

**Open questions inherited from the prototype** (these need answers before or during Phase 1, not before this PRD ships):

- Does the worker-harvest-pulse model survive deterministic ticks, or does it become event-driven?
- Is "energy node" the right primitive, or do we want a different resource-shape now that the sim is built for it?
- The defender/raider/worker counter-triangle — does it hold up as one of two factions, or does the second faction need a different unit roster entirely?

---

_This is a living document. When something here is settled, replace the language with what was decided. When something here is wrong, change it and note the date._
