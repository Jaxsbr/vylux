# Vylux — Plan

> **Last updated:** 2026-05-10 — fresh start.
> **Visual north star:** [`concepts/Isometric_3D_real-time_strategy_game_screenshot_Tron-inspired_9f371fa3-921d-4540-84e9-165734ff064b_2.png`](concepts/Isometric_3D_real-time_strategy_game_screenshot_Tron-inspired_9f371fa3-921d-4540-84e9-165734ff064b_2.png) — dense glowing Tron city, cyan/red grid lines pulsing through the world, lit vertical structures, purposeful silhouettes.
> **Mindset:** the game must be fun. A good game loop matters more than feature count. Strip down to the minimum that's already fun, polish until it sings, *then* layer more on.

This is the single planning doc. Earlier `docs/product/PRD.md` and `docs/investigation/*.md` are retired (the historical noise was making it hard to see what is, was, and is going to be). `docs/manual.md` stays as the live catalog and gets stripped down as Phase A lands.

---

## Why this exists

The current build is mechanically rich — multiple units, three resources, supply, tech tiers, fog of war, energy dump, action bar — but the **opening minutes don't feel right.** It reads as prototype scaffolding, not as a designed experience. And the live visuals don't deliver the dense, pulsing neon-city energy of the concept art that Vylux was originally pitched against.

The fix is not "more features." The fix is to strip the surface back to a small core, polish that core until it's actually fun and actually beautiful, and only then start adding back. Most of what was built carries forward technically — the deterministic sim, the renderer architecture, the action bar, the faction picker — but a lot of catalog content gets put back in the box.

---

## Direction

| Surface | Current | Target |
|---|---|---|
| Units | Worker, Defender, Raider, Vanguard | **Worker only.** Combat units re-introduced via tech tree later, one at a time. |
| Structures | HQ, Forge, Spire, Pylon | **HQ only.** Others re-introduced as research outputs, or not at all. |
| Resources | Energy, Flux, Colour | **Energy + Matter.** Matter = the construction material (you build with it). Energy = the power that runs things. Most units and structures cost **both** at build/train time; some are **matter-only** (no power required); the cost system has to support that split cleanly. Flux + Colour out. |
| Research | Tier-2, Trail+ | **New trees rooted at HQ.** Each research result produces both a behavioural change *and* a visible change. |
| Win condition | Destroy enemy HQ | Unchanged. The loop earns a richer condition once the loop is fun. |
| Visual fidelity | Sparse Tron grid | Dense glowing Tron city — pulsing energy along grid lines, lit vertical structures, ambient inhabited backdrop. Match the concept image. |
| Rogue mob spawns | Pending (was 3.13) | **Dropped.** Not on the plan. |
| Faction picker (Swarm / Siege) | Live | **Stays.** Asymmetry has little to live in until units return; that's fine. |

---

## Phases

Phase N+1 begins when N's exit gate is met. Each phase ends with `docs/manual.md` updated and the verify gate (`npx tsc --noEmit && npm run test && npm run test:e2e`) green.

### Phase A — Strip & Stabilise

Leave the sim in a small, clean, deterministic state that's worth polishing.

- Land **Resign** command (last 3.11b plumbing item).
- Drop the legacy 100-point win threshold; HQ destruction is the only path.
- Remove Defender, Raider, Vanguard from active sim. `CommandKind` slots stay reserved (replay back-compat — see `AGENTS.md` determinism contract).
- Remove Forge, Spire, Pylon from active sim. Same dead-slot rule for any commands.
- Remove Flux + Colour resources. Energy stays.
- Remove Tier-2 + Trail+ research; the worker energy-dump goes with them for now. Re-evaluate at Phase C.
- Update `docs/manual.md` to the stripped state.
- Retire `docs/product/PRD.md` and `docs/investigation/*.md`.
- Update `AGENTS.md` — add the **Mindset** block (text below).
- Bump `REPLAY_VERSION`; regenerate golden fixtures (`RECORD_GOLDEN=1 npm test`).

**Exit:** `npm run dev` shows HQ + workers + energy nodes on a Tron grid. The match still ends on HQ destruction. Verify gate green. Manual reflects reality.

### Phase B — Visual Reset

Live build looks like the concept image.

- Side-by-side audit: current scene vs `concepts/...screenshot_2.png`. Catalogue the gap.
- Likely items (each a small landed change, with a screenshot diff to the concept image as the bar):
  - Pulsing energy along grid lines, intensity flowing toward each faction's HQ.
  - HQ as a Tron tower — vertical silhouette, internal glow, animated panels.
  - Worker movement reads as energy in motion (faint trail, internal pulse).
  - Ambient backdrop: non-interactive lit "city" tiles around the playable arena, so the world feels inhabited even when nothing's happening.
  - Faction-colour duality at the world layer — cyan-tinted half, red-tinted half, neutral mid-grid.
- Polish over breadth. Each item is allowed to take its own time.

**Exit:** a side-by-side of live build and concept image reads as the same game.

### Phase C — HQ + Worker Depth

The opening 5 minutes are fun on their own, before any combat unit exists.

Phase C runs as a series of focused sub-phases. Each lands one mechanic end-to-end (sim + render + tests + docs) before the next starts. Phase B (visual reset) was attempted and reverted — visuals appear here only when they serve to convey functionality.

#### Phase C.1 — Work pods + worker charge (active)

A "work pod" is a player-built structure that raises the worker cap, hosts (future) worker-upgrade research, and recharges workers. Workers carry their own energy charge and have to come back to a friendly pod (or HQ as a slower fallback) to refill.

**Worker state machine.** The current four `WorkerPhase` values (`idle`, `movingToNode`, `harvesting`, `returning`) gain four more: `movingToBuildSite`, `building`, `walkingToCharge`, `charging`. The last two together are **charge mode** — neither accepts player commands.

**Energy accounting.**
- Each worker has `charge` and `maxCharge`. Fresh-trained workers start at full.
- One **task** drains 1 charge **at start**. Tasks: one harvest cycle (movingToNode → harvesting → returning → deposit), one build action (movingToBuildSite → building).
- Movement (`MoveUnit`) is free **while charge > 0**.
- Aborted task = full drain (no refund). A player redirecting a mid-cycle worker pays the energy.
- At end of any task, if `charge === 0` the worker enters `walkingToCharge`.

**Charge mode rules.**
- All player commands targeting a worker at `charge === 0` (or already in `walkingToCharge` / `charging`) are silently rejected. The renderer fires a floating lightning cue at the worker.
- Charge mode is sticky — the worker must reach a charge spot and **fully** recharge before becoming actionable.
- Charge-spot picking: **always prefer the nearest friendly operational work pod**. Fall back to HQ only if no pod exists.
- Charge rate at a work pod: `+1 / 20 ticks` (~10 s full tank). At HQ: `+1 / 40 ticks` (~20 s — 50% slower).

**Capacity.**
- HQ: starting cap of 5 workers.
- Each operational work pod: `+5` cap.
- `TrainUnit` silently rejected when at cap.

**Work pod (structure).** HP 100, build cost 60 Energy, build time 30 ticks (1.5 s). Built by a worker walking to the placement tile and constructing it (1 charge consumed on the worker for the build task). Worker-driven build resurrects the `BuildStructureByWorker` command slot (11) — same shape as before the Phase A strip, scoped now to the work pod only.

**Faction asymmetry (first cut).** Existing speed/harvest-interval split stays. Layered on top:
- **Swarm** worker: trainCost 40, maxHp 30. (Cheap + fragile.)
- **Siege** worker: trainCost 60, maxHp 60. (Costlier + tougher.)
- Charge tank + charge rate identical across factions for this cut — divergence lands with the upgrade tree.

**Visuals (functional only).**
- Charge bar under each worker's HP bar.
- Work pod silhouette distinct from HQ (lower, wider). No aesthetic polish.
- Floating lightning cue when the player tries to command a worker in charge mode.

**Tech-tree slot.** Selecting a work pod surfaces the research panel. C.1 ships a single research item to validate the slot end-to-end:

- **Auto-Resume** (80 E, 80 ticks). Once complete, workers automatically resume their last harvest target after charging. Without it, a fully-charged worker drops to idle and waits for a new command. The flag is faction-level: any worker on that faction reads it after research lands. If the previous node has been depleted, the worker drops to idle anyway.

Future research items land as additional `ResearchKind` values, additional rows on the action-bar dispatch, and additional case arms on the completion switch — no new commands needed.

**AI (C.1).** The AI trains workers to the supply cap, then builds a work pod (up to 5 owned pods) to grow the cap. Tile placement is a deterministic offset table around the AI's HQ. No autonomous research yet — the AI doesn't yet choose to research auto-resume on its own; that's a player decision for now.

**Out of scope for C.1.** Matter resource, additional research items, energy-trail mechanic, combat units, autonomous AI research. All planned later.

**Exit:** verify gate green (tsc + unit tests + e2e). A player can build a work pod, watch a worker recharge, and hit the worker cap.

#### Phase C.2+ (later sub-phases — design open)

- Worker upgrade research hosted at work pods. The energy-trail mechanic returns here as one upgrade-tree option.
- Matter as a second resource (construction material). Cost system handles `{ energy?: number; matter?: number }`. Open question: is Energy purely a build-time cost or also an ongoing upkeep?
- HQ research track (vision aura, storage cap, auto-defence beam, etc.).
- Each research result must change something **visible** on the HQ or worker — research the player can't see is research that doesn't reinforce the loop.

**Phase C exit:** ≥3 internal sessions per faction-pick where the player spends 5 minutes building economy + researching, and reports the time as enjoyable.

### Phase D — First Combat Unit

Introduce *one* combat unit, designed against the new tech tree — not ported from the old prototype.

- Spec from scratch: role, motion personality, visual evolution path through research, whether it earns a supply system back, where it's trained.
- Land as a single research target, not as a default availability.
- Re-evaluate whether any of the previously-stripped units (Defender / Raider / Vanguard) deserve to come back. They probably don't return as-is.

**Exit:** a PvAI match plays through to HQ destruction with the new combat unit on the field.

### Phase E — Loop Closure (the fun gate)

The original Phase 3.14 question, asked properly.

- ≥10 internal matches across both faction-picks.
- The "do I want to start another match?" answer must land as yes.
- If no: don't add more — go back and fix what the playtest surfaced.

**Exit:** the loop is fun. From here, additional phases (more units, scenarios-as-data, meta-progression) get planned individually.

---

## What survives, what dies

**Keeps:**
- Deterministic sim core (`src/sim/`) — `fixed.ts`, `rng.ts`, `hash.ts`, replay infra.
- Renderer architecture (`src/render/`) — read-only consumer of sim state.
- Three.js + Vite + Vitest + Playwright stack.
- Action bar (selection-driven, Phase 3.10).
- Worker-driven building, once we reintroduce something for workers to build.
- Faction picker (Swarm / Siege) — visual stays even with thin asymmetry for now.
- `docs/manual.md`, `docs/concepts/`, `AGENTS.md` (with the Mindset addition).

**Dies / dormant:**
- `docs/product/PRD.md` — retired.
- `docs/investigation/*.md` (00 through 04) — retired.
- Defender, Raider, Vanguard — out of active sim (slots reserved).
- Forge, Spire, Pylon — out of active sim (slots reserved).
- Flux + Colour resources — out.
- Supply system — out, until unit count makes it earn its keep again.
- Tier-2 research, Trail+ research, worker energy-dump — out for now; re-evaluate at Phase C+.
- Rogue spawn system (was 3.13) — never lands. Dropped.
- `src/net/` (lockstep / WebRTC / observer) — already dormant; stays dormant.

---

## Doc shape from here

- `docs/plan.md` — this doc. Updated as phases close.
- `docs/manual.md` — the catalog. Updated whenever a unit / structure / resource / research / control / map changes.
- `docs/concepts/` — visual reference.
- `AGENTS.md` — module layout, determinism contract, **mindset**.

No more investigation series. No more PRD vs investigation vs manual triangulation. One plan, one manual, one architecture doc.

---

## AGENTS.md — Mindset block (to be added in Phase A)

> **Mindset.** The game must be fun. A good game loop matters more than feature count. When in doubt, strip down — three landed mechanics that work beat ten that don't. Don't extend the catalog ahead of the loop being fun on its current surface. The visual north star is `docs/concepts/Isometric_3D_real-time_strategy_game_screenshot_Tron-inspired_9f371fa3-921d-4540-84e9-165734ff064b_2.png`; the planning anchor is `docs/plan.md`.
