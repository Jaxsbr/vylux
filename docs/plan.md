# Vylux — Plan

> **Last updated:** 2026-05-24 — Phase C re-sequenced after a gameplay review (opening 5 min not yet fun). Experience work (HUD, audio, motion, onboarding) now precedes the economy/research depth, which is deferred to C.7–C.8. C.4 re-scoped: "world life" is now entity-driven (HQ/pod idle animation) rather than a moving grid; the grid-line pulse is deferred within C.4, attempted only if the scene still reads static after the entity work lands. C.6 spec refined 2026-05-24: tutorial gains explicit completion goals (energy balance / 15 workers / find the enemy HQ) and instructional ghost-cursor bubbles that demonstrate each gesture; the energy goal is a balance read, so no sim-state change. Map work inserted as **C.6.5** ahead of the economy depth by owner direction (2026-05-24): double the grid to 64², ~16 seeded random nodes with low/med/high values + brightness, fully-random (not mirrored), placement barred from HQ / HQ-adjacent / edge tiles and guaranteed ≥1 node in each HQ's vision; the tutorial keeps its hand-placed layout. Two further sub-phases inserted 2026-05-24 by owner direction: **C.6.6** (sim-side obstacle avoidance so workers stop clipping through the HQ / pods / nodes — accepted as a sim change, goldens regen + version bump) ahead of the economy; and **C.7.5** (a dedicated **Resource Depot** building — a closer offload point that fixes the long-haul collection stall, plus the resource-collection research tree — sequenced after C.7 so it collects Matter too, not just energy).
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

The opening 5 minutes must be fun on their own, before any combat unit exists.
Phase C runs as a series of focused sub-phases — each lands one slice end-to-end
(sim + render + audio + tests + docs) before the next starts.

> **Status: not met (2026-05-23 review).** An uninstructed playthrough — HQ →
> train worker → move → harvest → charge → build pod → research auto-resume —
> confirmed the *mechanics* all work, but the *experience* is flat: the HUD reads
> cheap, actions give no reward, and nothing tells the player what to do. The
> sub-phases below are re-sequenced to close that gap first; the original
> economy/research work is deferred to C.7–C.8. Phase B's "vibe pass" landed
> earlier (sky / layered grid / fog); the remaining at-rest liveliness is folded
> into C.4.

#### Review 2026-05-23 — findings (the gap to close)

Grouped by theme. Each later sub-phase cites the cluster(s) it closes.

**[CLARITY] HUD reads cheap; actions are easy to miss.**
- Command actions are plain text (`TRAIN WORKER`, `BUILD WORK POD`,
  `RESEARCH AUTO-RESUME`) — no icons, don't read as buttons, easy to miss.
- Panels resize to fit their text (`min-width` grows) → jittery, cheap look.
- The selection portrait is bland; worker status (IDLE / HARVESTING 5/10 /
  CHARGING 5/10) is good information shown as flat text — a missed chance for
  in-style visual conveyance.
- Readouts (cap 3/5, charge 5/10, harvest 5/10) are functional but ugly and
  inconsistent; there is no clean, persistent resource bar.

**[FEEL] Actions give no reward; the world is dead.**
- Game start is static — nothing pulses, no ambient sound, no sense of life.
- Missing SFX: move-assign, harvest-assign, charge start/complete, research
  start/complete. (Today only `click` / `trainComplete` / `buildComplete` /
  `factionSwitch` exist in `audio-manager.ts`.)
- Workers have no idle, move, or work-state animation — they sit lifeless.
- Charging shows only a tiny, near-invisible progress bar — no sound, no VFX.
- Research completion is invisible — no audio, no visual; the upgrade can't be
  seen or felt the moment it lands.
- Worker geometry is unreadable "dev art" — the worst silhouette in the game,
  and it fills the portrait box too.

**[ONBOARD] Nothing teaches the player how to play.**
- Menu → game is an instant cut, no transition.
- No goal or first-action prompt on entry; the player doesn't know what to do.
- Right-click-to-move and left-click-to-harvest are found only by guessing.
- The charge mechanic baffles (why stop? why not auto-resume? — that *is* the
  auto-resume research, but nothing says so). Building a pod and researching are
  done "out of boredom," with no sense of why.
- No tutorial. Need a **Tutorial** entry on the main menu → a sandbox with
  visual + textual cues for: move, action, build, capacity, research, harvest.

**[OPEN] Worker training is instant — no queue, no wait.**
- Decide in C.2: keep instant, or add a short train timer + production queue.
  Recommendation — add a short timer + queue: it gives the command card a live
  element and the player a beat of anticipation. It's a sim-level change (train
  time), so it lands with the HUD work or as a small sim tweak beside it.

#### Sub-phase sequence (re-sequenced 2026-05-23)

| #   | Sub-phase                               | Closes        | State                |
| --- | --------------------------------------- | ------------- | -------------------- |
| C.1 | Work pods + worker charge + auto-resume | —             | ✅ landed 2026-05-12 |
| C.2 | HUD overhaul — SC2 command-card model   | CLARITY, OPEN | ✅ landed             |
| C.3 | Game-feel: audio (synth ambient + SFX)  | FEEL          | ✅ landed             |
| C.4 | Game-feel: motion & world life          | FEEL          | ✅ landed (entity-driven; grid pulse deferred) |
| C.5 | Worker silhouette redesign              | FEEL, CLARITY | ✅ landed (hovering hex courier) |
| C.6 | Onboarding & tutorial sandbox           | ONBOARD       | ✅ landed 2026-05-24 (#17) |
| C.6.5 | **Map: bigger arena + randomised energy field** | new scope | ✅ landed 2026-05-24 |
| C.6.6 | **Sim-side obstacle avoidance (worker pathing)** | new scope | spec'd 2026-05-24 |
| C.6.7 | **AI behaviour — scout, expand-harvest, grow** | new scope | spec'd 2026-05-25 |
| C.7 | Economy depth — Matter + cost split     | (was C.2)     | deferred             |
| C.7.5 | **Resource Depot — collection building + research** | new scope | spec'd 2026-05-24 |
| C.8 | Research depth — worker + HQ trees      | (was C.2)     | deferred             |

The original "C.2+" economy/research work (Matter, upgrade trees) is intentionally
pushed behind the experience work — it is **C.7–C.8** now. Don't pull it forward:
a richer economy layered on a flat-feeling loop doesn't move the fun needle.

#### Phase C.1 — Work pods + worker charge ✅ (landed 2026-05-12)

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

#### Phase C.2 — HUD overhaul (SC2 command-card model) · [CLARITY, OPEN]

> **Landed 2026-05-23. Exit gate met.** All four SC2 regions shipped:
> resource bar (HQ / Energy / Matter-reserved / Supply), portrait panel
> (action-state icon + HP / charge bars), the command card (fixed 3-wide
> icon-tile grid with hotkey + cost badges + a production-queue strip), and
> the minimap (fog-respecting blips driven off mesh visibility, a camera-focus
> marker, click-to-pan). Plus the `[OPEN]` train timer + queue and the two
> faction-stat fixes (Swarm/Siege maxHp + trainCost now actually applied). The
> card + portrait were done by enhancing the existing `action-bar.ts` +
> `selection-portrait.ts` (reusing their tested selection logic) rather than a
> from-scratch `src/render/hud/CommandHud` module — same SC2 information
> architecture, much less churn.

Replace the ad-hoc bottom-corner HUD with one StarCraft 2-style command HUD:
icon-driven, fixed-footprint, readable. Copy SC2's *information architecture*,
not its art — keep Vylux's charcoal + neon palette.

Target layout:

```
┌ E 80   M 120 ───────────── SUPPLY 3/5 ─┐
│                                         │
│             [ game world ]              │
│                                         │
├─────────┬──────────────────┬────────────┤
│PORTRAIT │  COMMAND CARD    │  MINIMAP   │
│ ╔═════╗ │  ┌──┐┌──┐┌──┐    │ ┌────────┐ │
│ ║ WKR ║ │  │TR││  ││  │    │ │   ▙    │ │
│ ╚═════╝ │  ├──┤├──┤├──┤    │ │      ▟ │ │
│ WORKER  │  │  ││  ││  │    │ └────────┘ │
│ HARVEST │  └──┘└──┘└──┘    │            │
└─────────┴──────────────────┴────────────┘
```

- **Resource bar (top):** fixed-width fields, never resize-to-fit — Energy now,
  **Matter reserved + greyed** (goes live in C.7), Supply n/m. Monospace, aligned.
- **Portrait panel (bottom-left):** keep the existing WebGL mesh portrait
  (`PortraitRenderer`) + name, but render status as **icon + bars**, not flat
  text — HP bar, charge bar, and a current-action icon (idle / move / harvest /
  charge / build). Keep the numeric count as a small badge. Fixed footprint.
- **Command card (bottom-center):** a fixed **3-wide icon grid**. Each action
  (Train Worker, Build Work Pod, Research Auto-Resume) becomes a square icon tile
  with a hotkey corner + cost badge + disabled/dim state (the reasons already
  exist in `action-bar.ts`). Empty slots render as dim grid cells so the grid
  never resizes.
- **Minimap (bottom-right):** consolidate the existing map work (#8/#9) into the
  fixed grid cell.

Deliverables:
- Refactor `action-bar.ts` + `selection-portrait.ts` into a unified `CommandHud`
  under `src/render/hud/` (CSS grid, fixed sizes — no `min-width` growth).
- An icon set (inline SVG or canvas glyphs, Tron neon) for: train, build-pod,
  research, and the worker action states.
- Resource-bar component with fixed fields (Energy / Matter-reserved / Supply).
- Resolve the **[OPEN]** training decision; if "timer + queue", add the train
  timer to the sim (`units-config` train ticks, applied in `step.ts`) and a
  production-queue strip to the HUD, and regenerate the golden fixtures.
- **Reference shots (saved):** `docs/concepts/sc2-hud-reference-unit-selected.jpg`
  (single unit selected — resource bar, portrait + stats, command card, minimap)
  and `docs/concepts/sc2-hud-reference-build-action.jpg` (a build-placement
  command context, our build-work-pod analogue). Source: interfaceingame.com
  (SC2: Legacy of the Void). Copy the *information density + region roles*, not
  SC2's exact corners — Vylux's placement (resources top-left, minimap
  bottom-right) is the ASCII mock above; SC2 mirrors those two.
- e2e: the command card shows the correct tiles per selection (HQ → train,
  worker → build-pod, pod → research) and renders disabled states; `tsc` / unit
  green; update `docs/manual.md` controls.

Out of scope: animated juice (C.3 / C.4); live Matter values; minimap
interactivity beyond what exists.

**Exit:** the four regions (resources / portrait / command card / minimap) are
present, fixed-footprint, and icon-driven; every C.1 action is reachable as an
icon tile; verify gate green; manual controls updated.

#### Phase C.3 — Game-feel: audio (synth ambient + action SFX) · [FEEL]

Fill the silence. Stay fully synthesised — extend the Web Audio layer in
`src/audio/audio-manager.ts`; **no external assets, no loader.**

Deliverables:
- **Ambient bed:** a low, slowly-pulsing Tron drone (oscillator + slow LFO),
  faction-tinted via the reserved `FACTION_FREQ_BASE` (cyan vs red base pitch),
  at a volume well under the SFX. Starts on match begin; respects the mute toggle.
- **New cues:** `select` (distinct from `click`), `moveAssign`, `harvestAssign`,
  `chargeStart` / `chargeComplete`, `researchStart` / `researchComplete` (a
  rising "unlock" chime).
- **Wire each cue at its fire site:** move / harvest assign next to the existing
  `FeedbackOverlay` calls in the input controller; charge transitions and
  research-complete detected renderer-side (the `event-detector` / phase-change
  watch in `sim-renderer`) so the **sim stays untouched** and the determinism
  gate is unaffected.
- Tests: cues fail-soft without a user gesture (existing pattern); manually
  verify the bed loops + ducks under SFX. Update the manual's audio note.

Out of scope: real music / sampled SFX (deferred by decision — synth only).

**Exit:** every player action fires a distinct cue; an ambient bed plays from
match start; mute silences all of it; verify gate green.

#### Phase C.4 — Game-feel: motion & world life · [FEEL] ✅ landed 2026-05-23

Make entities and the arena feel alive, and make every work-state visible.
Renderer-only (`feedback.ts`, `sim-renderer.ts`, `meshes.ts`, plus new
`entity-life.ts` + `work-beam.ts`, charge ring in `entity-chrome.ts`) — **sim
untouched**, determinism safe.

**Landed (entity-driven life):** worker idle hover (body-only, never clips the
floor); moving workers energise their body glow so transit reads differently
from rest; charge ring (gold radial fill, replaces the tiny charge bar);
work-state beams (green→node harvesting, gold→pod/HQ charging, faction→structure
building); HQ life (accent-cap pulse + body-tier breathe), operational-pod cap
pulse, and energy-node life (slow core spin + emissive breathe) so the arena
reads alive at rest *before* any worker exists; research-complete ripple on
every owned worker + pod. The grid-line pulse stayed **deferred** (see below) —
the arena now reads alive through its entities, so it wasn't needed. `tsc` +
unit (incl. new `entity-life.test.ts`) + e2e smoke (with a dropped-steps perf
guard) all green.

Deliverables:
- **Worker idle:** a subtle bob / internal pulse so a standing worker reads alive.
- **Worker move:** a faint motion trail / directional internal pulse ("energy in
  motion", carried over from the Phase B plan).
- **Work-state VFX:** harvesting → a beam / pulse between worker and node;
  building → keep the existing build animation + a constructing shimmer; charging
  → a clear charge VFX at the pod and a readable charge ring on the worker
  (replaces the "tiny invisible bar"). These mirror the portrait status icons
  from C.2.
- **Research-complete VFX:** a pulse on the pod and on every affected worker the
  instant the upgrade lands (pairs with C.3's `researchComplete` chime).
- **Building life:** give the HQ and worker pods their own subtle idle animation /
  internal pulse — the same "alive at rest" treatment as the worker idle bob. The
  arena should feel alive through its *entities*, not a moving backdrop.
- Keep / upgrade the floating-lightning reject cue when a charge-locked worker is
  commanded.
- Tests: e2e smoke that the scene renders with no perf regression (respect the
  `MAX_STEPS_PER_FRAME` budget); `tsc` / unit green.

**Deferred within C.4 — grid-line pulse (revisit only if needed):** the Phase B
"world life" idea of an ambient pulse along the grid lines toward each HQ + the
lit-backdrop tiles. Risk: the whole grid in motion may be more visually
distracting than alive. So do this *last* — land everything above first, then
play it and judge whether the arena already feels alive through its entities.
Only if it still reads static at rest do we attempt the grid-line pulse.

Out of scope: any new sim state; combat VFX.

**Exit:** a standing / moving / harvesting / charging / just-upgraded worker each
look visibly different; the HQ / pods / workers give the arena life at rest (no
static scene) — entity-driven, grid pulse only if still needed; verify gate green.

#### Phase C.5 — Worker silhouette redesign · [FEEL, CLARITY] ✅ landed 2026-05-23

Give the worker a readable, on-theme silhouette — which also fixes the portrait,
since `PortraitRenderer` shows the real mesh.

Deliverables (`meshes.ts`; the portrait picks it up for free):
- Replace the current worker geometry with a clear Tron read (e.g. a small
  hovering data-courier / harvester), distinct from HQ and pod, and distinct
  between factions via the existing emissive tint. Commit to one read.
- Verify it reads both at game scale and in the 128px portrait box.
- Keep the `entity-chrome` conventions (glow edges, selection ring, HP / charge
  bar) unchanged. Re-touch HQ / pod silhouettes only if the worker change makes
  them inconsistent — keep scope tight.
- Tests: `source-scan` + `tsc` green; visual check in scene + portrait. Update
  the manual if the described silhouette changes.

Out of scope: animation (C.4 — the two reinforce each other visually); new units.

**Exit:** a new player can tell at a glance what a worker is, in-world and in the
portrait; verify gate green.

**What landed:** the old 4-sided diamond (which echoed the gold 4-sided
energy-node spike — a clarity bug) became a **hovering hex-courier**: a wide
flat hexagonal hull (saucer deck) with a faction-bright core canopy on top and
an underbelly tapering to a thruster pad, so it reads as a small harvester drone
floating above the grid. All `entity-chrome` chrome (selection ring, HP / charge
bar, glow edges, harvest-fill halo, C.4 idle-hover + move-glow) is unchanged —
the redesign lives entirely in `legacy/worker.ts`'s geometry, so the renderer is
the only thing touched and the sim/determinism gate is untouched. Faction tint
is the unchanged `FACTION_EMISSIVE` map. Verified in-scene (distinct from the HQ
tower + node spikes) and in the 128px portrait.

#### Phase C.6 — Onboarding & tutorial sandbox · [ONBOARD]

Teach the basics; remove the "discovered by guessing" wall. Lands **after**
C.2–C.5 so it teaches a HUD worth pointing at and actions that already feel good
— don't build it earlier.

**Shape (refined 2026-05-24).** Two phases inside one sandbox scenario. A
**guided phase** walks the player through each gesture with an animated
demonstration; a **graduation phase** then turns them loose on three completion
goals. Reaching all three → a "TUTORIAL COMPLETE" overlay → back to the main
menu.

**Sandbox scenario:**
- A fixed `TUTORIAL_SPEC` match (deterministic seed, generous starting energy,
  energy nodes clustered near the player HQ, the enemy HQ in the far corner just
  as in a normal match). **No enemy pressure** — faction 1's AI command path is
  not run, so its HQ sits passively for the "find the enemy" goal.
- New **Tutorial entry** on the main menu (alongside the faction picks) launches
  it. A `?tutorial=1` deep-link enters it directly (for e2e + share links),
  mirroring the existing `?menu=skip`.

**Guided phase — instructional bubbles.** A new DOM "coach" overlay anchors a
callout to the relevant target — a HUD region, or a world entity projected to
screen via `camera.project()` — and loops a **ghost-cursor animation that
demonstrates the gesture**: e.g. a ghost cursor glides over the HQ, plays a click
pulse, and the HQ selects; move shows the cursor travelling + a right-click ring;
harvest shows a left-click on a node. Reuses the menu's ghost-cursor idiom (ring
+ dot + CSS keyframes, `main-menu.ts`). Each step is **gated on the player
actually doing the thing** before the next bubble appears. Order (playtest-tuned
2026-05-24): (1) select HQ → (2) train workers **to the supply cap (5/5)** →
(3) select a worker → (4) build a work pod to raise the cap → (5) harvest →
(6) camera controls (zoom / pan / minimap, ack) → (7) scout a worker toward the
enemy corner → (8) read the charge meter (ack) → (9) select the work pod →
(10) research auto-resume. Train-to-cap precedes building so the build step
always has a freshly-charged worker (no greyed-button wait) and the capacity
wall motivates the pod; the supply pill **pulses red/white at the cap**;
**select-a-worker and select-the-pod are their own steps** (the ghost points at
an actual worker / pod) so the build + research instructions aren't ambiguous
once five workers are on the field; scouting points at a tile toward the enemy
HQ to seed the find-the-enemy goal.

**Graduation phase — completion goals.** Once the gestures are taught, a small
persistent objectives panel shows three goals; reaching all three completes the
tutorial:
- **Energy:** current energy balance ≥ N (~300, tune in playtest). Pure read of
  `factions[player].energy` — the value the resource bar already shows. **No sim
  change, no golden-fixture regen.**
- **Workers:** ≥ 15 alive workers (`factions[player].supplyUsed`). Supply cap
  starts at 5 and grows +5 per operational pod, so this goal *forces* the player
  to build pods — it reinforces build + capacity without a separate gate.
- **Find the enemy HQ:** the enemy HQ tile becomes explored (render-side
  `Exploration` read) — the player scouts a worker across the map to uncover it.

**Always-on bits (apply to normal play too):**
- **Menu → game transition:** a short fade / wash into the match (reuse the
  menu's wash-gradient idiom) so entry isn't a jarring cut.
- **First-action nudge** on a normal match start (a single "select your HQ") so
  even non-tutorial entry has a clue.
- **Skip / exit-to-menu** at any time; completion or skip → reload back to the
  menu (the existing match-end reset — `player-input.ts` already reloads to
  re-show the menu).

**Where it lives (implementation sketch):**
- `src/render/tutorial/` — a step machine (`tutorial-controller.ts`) polled from
  the rAF loop; a coach overlay (`coach-overlay.ts`: callout + looping
  ghost-cursor + pointer-to-target); and the goal tracker / objectives panel. All
  render-side — the tutorial *reads* sim + exploration state but never mutates the
  deterministic sim, so the hash stays clean.
- `TUTORIAL_SPEC` beside the other match specs; bootstrap branches on the menu's
  tutorial pick to load it and skip the AI command path.

**Tests:** e2e that the tutorial launches (menu entry + `?tutorial=1`), advances
on the gating action, surfaces the completion overlay when the three goals are
met, and is skippable; the goal predicates + step-advancement logic as unit tests
(pure functions); `tsc` / unit green. Update the manual (controls + a Tutorial
line + the three completion goals).

Out of scope: branching / adaptive tutorial; voice; multi-scenario campaign; any
sim-state change (the energy goal is a balance read, not a new harvested-total
field).

**Exit:** a first-time player completes the guided steps, then reaches all three
graduation goals (energy, 15 workers, enemy HQ found) unaided; "TUTORIAL
COMPLETE" returns them to the menu; menu → game has a transition; verify gate
green.

#### Phase C.6.5 — Map: bigger arena + randomised energy field · [new — owner-inserted 2026-05-24]

> **Inserted ahead of C.7 by owner direction (2026-05-24).** Jaco wants a
> larger, less hand-authored arena *before* the economy depth lands: double the
> map, more energy nodes, scattered randomly with randomised values, and a
> visible low/med/high tier read. Sequenced as the next sub-phase after C.6 —
> before the deferred economy (C.7) and research (C.8) work, not after the C
> phases.

Make every normal match's arena bigger and freshly-seeded instead of the six
fixed `energy: 200` nodes. The tutorial keeps its hand-authored layout (below).

**Map size.**
- Double the grid: `GRID_SIZE` 32 → **64** in `src/grid.ts` (≈4× play area —
  owner chose the linear double, not an area double). The floor, dividers,
  extended out-of-play grid, minimap, fog overlay, exploration, and
  `tileToWorld` bounds all derive from `GRID_CONSTANTS`, so they scale for
  free — but **verify** each: camera pan/zoom limits (`camera-controller.ts`)
  must let the player see and reach the far corner; the minimap blip scale
  stays readable; the extended-grid radial-fade radii
  (`extendedFadeInner/Outer`) likely need re-tuning against the new
  `worldExtent`.
- Reposition the two HQs to the new corners, keeping the anti-diagonal layout
  (player bottom-left, AI top-right), off the edge ring, with the same
  home-patch feel — e.g. ~(8, 55) and (55, 8), tunable.

**Randomised energy field (normal `SPEC` only).** Replace the fixed `nodes`
array with a **seeded** generator:
- **Count:** more than today's six — target **~16** on the 64² map (tune in
  playtest); a single tunable constant.
- **Random placement**, subject to these hard constraints:
  - never on an HQ tile;
  - never on any tile **directly adjacent** (the 8 neighbours) to either HQ;
  - never on a **map-edge** tile (the outer ring — tile index 0 or 63 on
    either axis);
  - no two nodes share a tile (suggest a small minimum inter-node spacing too,
    so they don't clump into one pile — tunable);
  - **≥ 1 node within `HQ_VISION_RADIUS` of *each* HQ.** This is a correctness
    constraint, not a fairness one: `initialHqDiscovery` only reveals nodes in
    HQ vision, and the AI auto-routes workers to *discovered* nodes — if a
    faction starts with zero discoverable nodes it never harvests and the
    bootstrap deadlocks (the exact case `state.ts` already guards against with
    the fixed layout).
- **Fully random, not mirrored** (owner decision 2026-05-24): each side's
  layout is drawn independently, so matches can be lopsided. Accepted. The
  ≥1-near-HQ rule above is the only floor — do **not** sneak symmetry back in.
- **Randomised values — low / med / high tiers**, drawn per node from the
  seeded RNG. Center the tiers on today's 200, e.g. low ≈ 120 / med ≈ 220 /
  high ≈ 360 energy, with a weighted draw (more low+med than high, so a high
  node is worth contesting) — all tunable.

**Determinism (hard requirement).** Placement and tier draws **must** use the
deterministic sim RNG seeded from `spec.seed` — never `Math.random` — so
replays reproduce. Cleanest seam: generate inside `createInitialState` (it
already builds `new Rng(spec.seed)`); to avoid perturbing the gameplay RNG
stream, draw map-gen from a **derived/dedicated** sub-seed before gameplay
draws begin. Node layout + values change, so **regenerate the golden fixtures**
(`RECORD_GOLDEN=1 npm test`) and bump `REPLAY_VERSION` if the replay's
seed-consumption shape changes. Confirm `hash.test` / `replay.test` /
`golden.test` are green after regen.

**Tier visuals — "brighter the higher" (`energy-node.ts`).** A node's tier
sets its **neutral/base** look (a *slight* shift per the brief — not a
recolour):
- rim emissive intensity scales with tier (e.g. low ≈ 0.16 / med ≈ 0.28 /
  high ≈ 0.45 vs today's flat 0.25), plus a subtle hue lift toward a brighter
  near-white cyan on `high`;
- the tier base is what the rim **restores to** after a harvest tint clears
  (`setHarvestingTint(null)`) and after regen crosses back above the
  re-eligible threshold (`tickRegen`) — today those snap to the single flat
  `NEUTRAL_RIM`; they must now snap to the node's tier base instead;
- tier does **not** override the faction-hold tint, the active-harvest tint,
  or the exhausted (dead-grey) state — those are unchanged. Tier only colours
  the at-rest neutral read;
- the render node must learn its tier / max-energy from sim state
  (`node.remaining` at spawn) rather than the hard-coded `RESERVE_DEFAULT`, so
  the visual tier matches the actual reserve.

**Tutorial is exempt.** `TUTORIAL_SPEC` keeps **hand-placed, non-random** nodes
clustered near both corners — the coach ghost-cursor + harvest step depend on a
known layout. Re-fit its HQ + node coordinates to the new 64² bounds (they
currently top out at 27 on the 32 grid), keep the clustered home patches, and
leave the far-corner enemy HQ for the "find the enemy" goal. The bigger map
lengthens the scout step slightly — acceptable; sanity-check it still
completes.

**Tests.** Unit-test the generator as a pure, seeded function: same seed →
same layout; all constraints hold (no HQ / adjacent / edge tiles, no
duplicates, ≥1 within HQ vision of each HQ); tier distribution lands in range.
`tsc` + unit + e2e green; e2e smoke that a normal match still boots and the AI
harvests (deadlock guard). Golden fixtures regenerated. Update `docs/manual.md`
(map size, node count, the low/med/high tiers + their meaning) when it lands.

Out of scope: Matter / cost-split (still C.7); node regen-rate changes; biome
or terrain variety; symmetric / mirrored layouts (explicitly rejected this pass).

**Exit:** a normal match opens on a 64² arena with ~16 randomly-placed,
randomly-tiered energy nodes that obey every placement constraint and never
deadlock the AI; low / med / high nodes read as progressively brighter at rest;
the tutorial still runs on its fixed layout; replays reproduce and the verify
gate (incl. regenerated goldens) is green.

**What landed (2026-05-24).** `GRID_SIZE` 32 → 64 (`src/grid.ts`; the floor,
minimap, fog, exploration, and camera pan-limit scale off `GRID_CONSTANTS` for
free — `ZOOM_MAX` bumped 0.68 → 0.85 in `scene.ts` so the far corner is
reachable by zoom-out). New seeded generator `src/sim/map-gen.ts`
(`generateEnergyField` + `ENERGY_TIERS` + `classifyTier`, 13 unit tests):
16 nodes, fully-random placement honouring every constraint (no HQ / adjacent /
edge tile, ≥3-tile spacing, ≥1 within each HQ's vision), weighted low/med/high
energy (120/220/360). HQs repositioned to (8,55)/(55,8); `TUTORIAL_SPEC`
re-fitted to 64² with its hand-placed clusters; AI pod-placement clamp 31 → 63
(`ai.ts`). Tier brightness lives in `meshes.ts` (`buildNodeMesh` takes the
node's reserve → scales the gold silhouette + rim emissive, and thus bloom,
brighter the higher, with a slight white lift on high). A fresh per-launch seed
randomises the field for PvA/observe (baked into the spec → replay); lockstep
keeps the fixed seed so peers agree.

**Determinism — lighter than the spec feared.** The generation seam is in
`main.ts` (the field is built into `spec.nodes`, which the replay already
serialises and `playReplay` reconstructs), **not** inside `createInitialState`
or the step loop. The sim is grid-size agnostic and `InitialMatchSpec`'s shape
is unchanged, so the golden fixtures (which use `scripted-match.ts`'s own specs)
were **untouched — no regen, and no `REPLAY_VERSION` bump.** Verify gate green:
`tsc`, 197 unit (incl. the unchanged golden gate + new `map-gen` tests), 10 e2e
(incl. AI-vs-AI smoke proving no harvest deadlock, and lockstep determinism).

**Playtest follow-ups (2026-05-24).** Two adjustments after playing the bigger
map:
- **Zoom re-tuned** (`scene.ts`): `DEFAULT_HALF_HEIGHT` scales with the grid, so
  the old range showed ~2× the tiles on the 64² map — too far out, not close
  enough in. New range: `ZOOM_MIN` 0.25 → 0.13 (deeper zoom-in, ~10 tiles tall),
  `ZOOM_MAX` 0.85 → 0.55 (tighter zoom-out, ~42 tiles; minimap + pan cover
  whole-map awareness), `DEFAULT_ZOOM_SCALE` decoupled to 0.25 for a good
  HQ-framed opening. Also fixed an orthographic **clip bug** the bigger map
  exposed: near/far were hard-coded ±100, but the camera distance scales with
  `worldExtent`, so the far half of the 64² grid (incl. the look-at target) was
  clipped — near/far now scale as `worldExtent · 4`.
- **Siege flattened to Swarm** (`units-config.ts`): the C.1 worker asymmetry
  (Siege slower 0.045 / costlier 60 / tougher hp 60 / faster harvest 17) made
  Siege strictly worse to play, so its worker stats + harvest interval are set
  equal to Swarm's. The override blocks stay as the divergence hook; real
  asymmetry returns with combat units (Phase D). A **sim-behaviour change** →
  `REPLAY_VERSION` 24 → 25 and all three golden fixtures regenerated (each
  exercises the faction-1 = Siege worker).

#### Phase C.6.6 — Sim-side obstacle avoidance (worker pathing) · [new — owner-inserted 2026-05-24]

> **Inserted by owner direction (2026-05-24).** Workers currently walk straight
> *through* the HQ, work pods, and energy nodes — the Chebyshev step-toward-target
> (`step.ts:519–540`) has no obstacle awareness, so it reads as unfinished. Add
> deterministic local avoidance so a worker routes *around* a static blocker
> instead of clipping through it. Sequenced now (a C.4 motion sequel), ahead of the
> economy work, because it's a standing visual blemish on the otherwise-polished
> motion pass.

**Sim-side, not render-only (owner decision).** Worker `x/y` are hashed sim state
(`sim.ts:120–121`), so a render-only nudge would let the mesh diverge from its true
position — the selection ring, work-beams, and arrival tile all key off the sim
position and would lag the dodge. Doing it in the sim keeps mesh + ring + beams in
agreement. The cost is accepted: it's a sim change → **regenerate the golden
fixtures and bump `REPLAY_VERSION`** (25 → 26), and travel paths get marginally
longer (slightly more time/charge per cycle — a deliberate, deterministic nudge).

**Approach.**
- Treat the few static blockers (HQ, operational work pods, depots, energy nodes)
  as small convex footprints with a soft clearance radius. There is **no occupancy
  grid today** (confirmed — `step.ts` has none); introduce only what's needed.
- **Local steering first, not full A\*.** When the straight `moveTowards` step would
  enter a blocker footprint, deflect the per-axis step tangentially around it and
  resume the straight line once clear. Our obstacles are small and convex, so local
  avoidance won't trap on concavities; reserve grid A\* for Phase D, where combat
  units in contested space actually need it.
- All math stays in fixed-point (`Fixed`, reuse `clampStep`) — never float, never
  `Math.*` — so replays reproduce.
- The worker's *own* destination footprint is exempt (it can walk onto the node /
  pod / HQ / depot it is targeting); avoidance applies only to blockers in the way.

**Tests.** Unit-test the avoidance step as a pure deterministic function (same
inputs → same path; a step that would enter a non-target footprint is deflected;
clear paths are unchanged, so straight-line behaviour is preserved where there's
nothing to avoid). Regenerate goldens; `tsc` + unit + e2e green; e2e smoke that the
scene still renders within the `MAX_STEPS_PER_FRAME` budget (no perf regression from
the per-step blocker checks).

Out of scope: grid A\* / global pathfinding (Phase D); unit-vs-unit avoidance (no
combat units yet); moving-obstacle avoidance.

**Exit:** a worker visibly routes around the HQ / pods / depots / energy nodes
instead of clipping through them; verify gate green incl. regenerated goldens.

#### Phase C.6.7 — AI behaviour: scout, expand-harvest, grow · [new — owner-inserted 2026-05-25]

> **Inserted by owner direction (2026-05-25).** C.6.5's 64² map + randomised
> energy field exposed an economic-AI gap: the AI only **auto-assigns idle workers
> to already-*discovered* live nodes** and never proactively scouts (`ai.ts` —
> `autoAssignIdleWorkers` + the train/pod build order; see `manual.md` → AI
> behaviour). On the small fixed map its home patch was enough; on the big random
> map, once the AI exhausts the nodes near its HQ it has **no discovered live node
> left and silently stalls** — it stops harvesting, never expands, and stops being
> a real opponent. Make the AI a competent economic player on the new map.

**Three behaviours.**
1. **Scout to uncover fog.** Periodically dispatch a worker to explore unseen tiles
   (toward the nearest unexplored region / map centre), flipping `discoveredBy`
   flags so fresh nodes become harvest-eligible. Target selection is deterministic
   (derived from sim state, **never `Math.random`**). This is the missing primitive —
   auto-assign already routes to the nearest discovered live node; the gap is
   *discovery*.
2. **Expand-harvest when the home patch exhausts.** When the AI has no discovered
   live node within easy reach, it routes workers to the nearest discovered live
   node *anywhere*, and if none is discovered, it scouts (behaviour 1) rather than
   idling. No economic deadlock.
3. **Grow via pods at the cap.** The cap→pod build already exists (train to cap →
   build a pod, ≤5, via the fixed HQ offset table). Harden it and bias pod
   placement *toward discovered node clusters* rather than only hugging the HQ —
   this is the same expansion instinct the C.7.5 depot-AI note calls for, so the
   two should share the cluster-targeting helper.

**Determinism.** AI logic is the pure `tickAi(state, faction)` returning
`Command[]` — it changes *what the AI does*, not the replay wire format, so **no
`REPLAY_VERSION` bump**, but the AI now plays differently → the **`ai-vs-ai-3000`
golden fixture must be regenerated** (`RECORD_GOLDEN=1 npm test`). All scout/expand
target picks must read deterministic sim state / the seeded RNG.

**Tests.** Unit-test the new decision helpers as pure functions (same state → same
commands; scouts when no discovered live node exists; expands to a distant
discovered node once the home patch is depleted; still builds a pod at the cap).
Extend the AI-vs-AI e2e smoke so it asserts **neither faction economically
deadlocks** over a long match on the 64² randomised map (strengthens C.6.5's
no-harvest-deadlock guard into a no-*stall* guard). Regenerate the `ai-vs-ai`
golden; `tsc` + unit + e2e green. Update `docs/manual.md` → AI behaviour.

Out of scope: autonomous AI research (still deferred — the AI doesn't research
auto-resume on its own); combat AI (Phase D); difficulty tiers; depot placement
(C.7.5, but it reuses this phase's cluster-targeting helper).

**Exit:** on a normal 64² match the AI scouts out from its home patch, keeps
harvesting after the nearby nodes deplete (no economic stall), and grows its
workforce via pods; an AI-vs-AI smoke proves no deadlock over a long match; verify
gate green incl. the regenerated `ai-vs-ai` golden.

#### Phase C.7 — Economy depth: Matter + cost split  (was C.2)

The original C.2 economy work, now after the experience pass.
- Introduce **Matter** as the second resource (construction material). The cost
  system handles `{ energy?: number; matter?: number }` cleanly — some costs
  energy-only, some matter-only, some both. The C.2 resource bar's reserved
  Matter field goes live here.
- Resolve the carried-forward open question: is Energy a build-time cost only, or
  also an ongoing upkeep?
- Tests + manual updated; regenerate the golden fixtures (sim cost shapes change).

#### Phase C.7.5 — Resource Depot: dedicated collection building + research · [new — owner-inserted 2026-05-24]

> **Inserted by owner direction (2026-05-24), sequenced after C.7.** Origin: once
> the energy nodes near the HQ exhaust, workers haul all the way back to the HQ to
> offload (deposit is hardcoded to the HQ — `step.ts:630–636`), the round trip
> balloons, and the collection rate craters — the opposite of the "economy
> accelerates with more workers" feel we want. C.6.5's bigger 64² map made this
> worse. The fix is a **dedicated resource-collection building** you plant near a
> fresh node cluster so the offload trip stays short. Owner chose a distinct
> building over reusing the work pod, and chose to land it *with the resource
> expansion* (C.7) rather than as an early energy-only patch: since Matter (C.7)
> adds a second resource, this building is the home for **multi-resource collection
> and the resource-collection research tree**.

> **Lever.** This defers the energy-haul stall fix until after C.7. If the stall
> hurts the Phase C fun gate before then, pull a minimal energy-only version of the
> deposit-retarget below forward as a stopgap (same `pickDepositTarget` seam) — but
> the full building lands here.

**The depot (new structure).** A worker-built structure dedicated to resource
logistics, distinct from the work pod (pod = supply cap + worker charge; depot =
resource collection + resource research). New `StructureKind`, new mesh (Tron-themed,
distinct silhouette from HQ / pod), worker-built via the existing
`BuildStructureByWorker` path (the pod already uses command slot 11 — the depot is a
second target of the same worker-build flow). HP / build cost / build time tuned in
scope.

**Deposit retarget (the stall fix).** Add `pickDepositTarget()` mirroring the
existing `pickChargeTarget()` (`step.ts:138–145`): a returning worker offloads at the
**nearest friendly operational depot, falling back to the HQ** — exactly the pattern
charge already uses. Called at the head of the `returning` phase in place of the
hardcoded HQ walk. Energy is a faction-global pool, so depositing at a depot still
credits `faction.energy` (no per-structure storage) — same for Matter once C.7 lands.

**Resource-collection research (the "relevant research").** The depot surfaces a
research slot (same infra as the pod's auto-resume — `ResearchKind` + action-bar row +
completion switch). Candidate items (pick a first cut in scope): deposit throughput,
deposit/collection radius, passive trickle-collection, or a yield bonus on nearby
nodes. Each must produce a **visible** change on the depot (reuse the C.4 beam/ring
idiom) — the C.8 rule applies here too. This is the *resource* research tree; C.8's
worker/HQ trees layer beside it.

**AI.** The AI plants pods around its own HQ via a deterministic offset table — it
won't *expand toward nodes* on its own, so a depot near remote clusters is a
player-only advantage at first. Teach the AI to place a depot toward its nearest
discovered-but-distant node cluster (deterministic, same RNG discipline).
Non-blocking if it slips, but note it so the AI doesn't stall on a depleted home
patch.

**Determinism.** New structure kind + the deposit retarget both change hashed sim
state → **regenerate the golden fixtures and bump `REPLAY_VERSION`**. Build the depot
placement and any research draws off the deterministic sim RNG — never `Math.random`.

**Tests.** Unit: `pickDepositTarget` picks nearest operational depot then HQ (mirror
the charge-target tests); the depot build + research-complete switch arm. e2e: a
worker offloads at a depot near a remote cluster (round trip shortened); the depot's
command card shows its research tile. Golden fixtures regenerated; `tsc` + unit + e2e
green. Update `docs/manual.md` (the depot, the deposit rule, the resource-research
tree).

Out of scope: combat-unit interaction; the depot doubling as a charge spot (decide in
scope — keep concerns split, or let the depot also charge so a remote cluster needs
one building, not two); meta-progression.

**Exit:** a player plants a depot near a remote node cluster, workers offload there
instead of hauling to the HQ, the collection rate holds as the economy scales out,
and ≥1 resource-collection research item lands with a visible change; verify gate
green incl. regenerated goldens.

#### Phase C.8 — Research depth: worker + HQ trees  (was C.2)

- **Worker-upgrade research, hosted at any operational work pod.** The first
  concrete worker-tree items beside the C.1 auto-resume validator. Each is a
  one-time, faction-level upgrade (the auto-resume single-active-research rule
  holds — at most one research mid-flight at a time), and each is **deliberately
  expensive** (well above auto-resume's 80 E) so it reads as a real economic
  commitment, not a default pickup:
  - **Harvest Speed** — cuts the worker harvest interval (`harvestTicks`, today
    23) by ~30% (≈16 ticks), so each parked worker gathers faster. Faction-level
    flag, mirroring `autoResumeResearched`. Cost ≈ **200 E / 200 ticks** (tune in
    playtest).
  - **Move Speed** — raises worker move speed (`speed`, today 0.055) by ~30%
    (≈0.072 tiles/tick), so transit + redeploy is quicker. Faction-level flag.
    Cost ≈ **250 E / 250 ticks** (tune).
  - The two together are a straight economy accelerant: `FactionConfig` notes
    that harvest interval normally pairs *inversely* with speed (fast workers
    harvest slower per tick), so buying both deliberately breaks that trade-off.
    That's the intent — the high price is what balances it.
  - The **energy-trail** mechanic also returns here as a further upgrade-tree
    option.
- **Determinism + HUD for the worker tree.** New `ResearchKind` values
  (`harvestSpeed`, `moveSpeed`) + matching `*Researched` flags on `FactionState`;
  the harvest-tick and move-speed reads consult the flags (a multiplier applied
  in `step.ts`'s harvest loop + movement, or surfaced through `factionConfigFor` /
  `unitStatsFor` taking the researched flags). New hashed fields + changed
  movement/harvest math → **regenerate the golden fixtures and bump
  `REPLAY_VERSION`**. The pod command card shows **one** research tile today; with
  three items it must become a small fixed grid of research tiles (auto-resume +
  the two speed upgrades) with per-item cost / disabled / in-progress / done
  states (the C.2 command-card model).
- HQ research track (vision aura, storage cap, auto-defence beam, …).
- Every research result must change something **visible** on the HQ or worker —
  research the player can't see doesn't reinforce the loop. Move Speed is
  inherently visible (workers visibly quicker); Harvest Speed reads via a faster /
  brighter work-beam pulse plus the C.4 research-complete ripple. (C.3 / C.4 make
  "visible + audible" real.)
- Tests + manual updated: add the two rows to the manual's Tech table + the
  multi-item pod-research note; regenerate the golden fixtures; unit-test that a
  researched flag actually applies its multiplier (deterministically); e2e that
  every research tile renders with the correct state.

**Phase C exit (the fun gate):** ≥3 internal sessions per faction-pick where the
player spends 5 minutes building economy + researching, and reports the time as
enjoyable. Now gated behind the experience work (C.2–C.6), not the economy work
alone.

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
