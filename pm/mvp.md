---
status: in-progress          # in-progress | complete
frozen_at: 2026-04-19
reopened_at_6: 2026-04-20T06:06:27Z
reopened_reason_6: "Owner review 6 (pm/inbox/2026-04-20-hp-contrast-raider-damage-defender-range-one-per-node.md) — playtest follow-ups: HP bars nearly invisible (dark-on-dark), raiders still 2-shot workers (need ≥5 hits), defenders regressed to strict-adjacency placement (should use HQ proximity zone), one-per-node invariant breaks under load, workers need HQ-idle fallback when nothing to harvest."
completed_at: 2026-04-20T02:09:19Z
completion_notes: "Reopen-5 closed. All 33 acceptance items ticked (13 original + 5 reopen-2 + 6 reopen-3 + 3 reopen-4 + 6 reopen-5). visual-eval-v17 under rubric v2 scored min 58 / threshold 48 / per-axis min 7, no hard-fails (idle-start 59, early-economy 58, mid-combat 58). 2 engineer commits this cycle: spawn-revert-and-hq-enclosure 17d81d4, combat-rebalance-targeting-feedback 0ba7459. New tunables: WORKER_HP=80, DEFENDER_HP=120, RAIDER_HP=60, RETALIATE_WINDOW_TICKS=4, DAMAGE_PULSE_DURATION=0.12s. Spawn-point mechanism removed and replaced with HQ-enclosure guard at placement time."
reopened_at: 2026-04-20T21:00:00Z
reopened_reason: "Owner review 5 (pm/inbox/2026-04-20-combat-balance-and-spawn-ux-feedback.md) — playtest feedback. Spawn-point mechanism frustrates testers → revert to adjacent-HQ spawn + HQ-enclosure-guard at placement time. Combat balance off in both directions (raiders 1-shot workers; defenders evaporate raiders). Raiders do no visible damage to defenders/HQ. Raider targeting is HQ-only (should retaliate then target nearest worker/defender/HQ). Damage/HP feedback invisible (no HP-bar live update, no damage flash). Owner praised reopen-4 as 7/10 — next round to push past."
prior_completed_at: 2026-04-19T23:34:18Z
prior_completion_notes: "Reopen-4 closed. All 27 acceptance items ticked (13 original + 5 reopen-2 + 6 reopen-3 + 3 reopen-4). visual-eval-v16 under rubric v2 scored min 58 / threshold 48 / per-axis min 7, no hard-fails (idle-start 59, early-economy 58, mid-combat 58). 1 engineer commit this cycle: ai-worker-parity-and-node-lifecycle 3921adf. New tunables: NODE_REGEN_RATE=0.4/s, MIN_REGEN_THRESHOLD=6 (regen 5× slower than harvest 2.0/s)."
prior_reopen_4_at: 2026-04-19T23:10:04Z
prior_reopen_4_reason: "Owner review 4 (pm/inbox/2026-04-19-bugs-worker-behaviour.md) — AI workers skip the walk/harvest/walk-back/offload loop that the player's workers follow; node occupancy is sticky (doesn't release when the worker leaves to offload); nodes can exhaust but never regenerate. Three basic-RTS parity bugs. Performance-review warning from owner — must land 6/10 MVP readiness."
prior_completed_at: 2026-04-20T20:29:44Z
prior_completion_notes: "Reopen-3 closed. All 24 acceptance items ticked (13 original + 5 reopen-2 + 6 reopen-3). visual-eval-v15 under rubric v2 scored min 54 / threshold 48 / per-axis min 7, no hard-fails. 3 engineer commits this cycle: map-layout-and-proximity 482b039, hq-spawn-point 3a5020d, worker-task-loop f5cf6cc."
prior_reopen_3_at: 2026-04-20T19:20:18Z
prior_reopen_3_reason: "Owner review 3 (pm/inbox/2026-04-20-worker-tasks-and-placement.md) — workers have no readable task model; placement rules too tight (can't train Raider when HQ is walled); map layout + HQ inset wrong; energy nodes read as blue-owned at rest."
prior_reopen_at: 2026-04-19T09:01:01Z
prior_reopen_reason: "Owner review 2 (pm/inbox/2026-04-19-mvp-what-is-it.md) — MVP is confusing and unengaging. Doing-nothing wins. Raiders can't travel. No tooltips/labels. Worker anim inconsistent. No event feedback pulses."
prior_completed_at: 2026-04-19T10:13:30Z
prior_completion_notes: "Reopen-2 closed. All 18 acceptance items ticked (13 original + 5 reopen-2). visual-eval-v12 under rubric v2 scored min 57 / threshold 48 / per-axis min 7. 5 engineer commits: offensive-reach e2fd4fb, idle-loses-tuning 6a753e4, buildables-and-node-tooltips fd17dbf, worker-legibility 965b010, event-feedback-pulses f7994a8."
earliest_reopen_at: 2026-04-19T07:06:46Z
earliest_reopen_reason: "Owner review 1 (pm/inbox/2026-04-19-mvp-failure.md) — mouse-driven play, onboarding, visual fidelity gaps."
earliest_completed_at: 2026-04-19T07:40:58Z
owner: vylux-pm
# Flip `status` to `complete` ONLY when every acceptance item below is checked
# AND the latest visual-eval score meets or exceeds the threshold in rubric.md.
---

# Vylux MVP

## One-line

A Tron-styled isometric RTS where **you (blue)** and **one AI opponent (red)** race to
a fixed point total by harvesting energy from a shared neon grid and building units
that either accelerate your economy or destroy theirs.

## Game loop (minimum)

1. Match starts on a **fixed square grid map** (no fog of war). Each player spawns
   at opposite corners with one **HQ** and two **workers**.
2. The grid itself trickles **passive energy** into each player at a capped rate
   (`BASE_INCOME`). This guarantees the player can always afford at least one basic
   unit — no soft-lock.
3. Players move **workers** onto **energy nodes** scattered across the grid. A
   worker standing on a node **multiplies income** above `BASE_INCOME`. Workers are
   not auto-harvesters — movement matters, which keeps the grid visually alive.
4. Players spend energy to train **units** from their HQ (or from a built
   production building). Units come in three flavours:
   - **Worker** — cheap, harvests on nodes, no combat.
   - **Defender** — medium cost, slow, high HP, only attacks adjacent tiles.
   - **Raider** — high cost, fast, low HP, can attack enemy workers and HQ.
5. **Points** accumulate from: (a) controlling energy nodes (1 pt/sec/node held),
   (b) destroying enemy units (5 pts each), (c) damaging the enemy HQ (1 pt per
   10 HP). First to `WIN_POINTS` (default **500**) wins.

## Acceptance checklist

Everything below must be checked off in this file *and* covered by at least one
Playwright scene screenshot committed under `pm/screenshots/`.

- [x] **Grid & camera** — isometric Tron-style grid renders; dark charcoal
      background; cyan tile outlines on hover. (already partially done)
- [x] **HQ building** — blue HQ bottom-left corner, red HQ top-right. Distinct
      neon silhouettes, visibly "Tron-like" (glow, outline, emissive).
- [x] **Worker unit** — placeable, selectable, moveable to a tile via click-to-move.
      Path is straight-line tile hops; no A* required.
- [x] **Energy nodes** — 4+ nodes distributed on the grid, visually distinct,
      glow when a worker of either faction stands on them.
- [x] **Energy resource** — top-left HUD showing `BLUE` and `RED` energy counters
      updating every tick. `BASE_INCOME` trickle even with zero workers on nodes.
- [x] **Unit training (mouse-driven)** — click the blue HQ to open a buildables
      panel (Worker / Defender / Raider, each with cost). Click a buildable, then
      click a grid tile to place the trained unit. Cost deducts from the
      faction's energy. Q/W/E may exist as dev-only fallbacks but are **not**
      the intended input path.
- [x] **Combat** — raiders and defenders auto-attack the nearest enemy within
      range each tick. Units have HP bars; deaths remove meshes.
- [x] **Point system** — top-center HUD showing `BLUE` and `RED` point totals.
      Points accrue from node control, kills, and HQ damage per the rules above.
- [x] **AI opponent** — red side builds workers → defenders → raiders on a simple
      timer-based build order, assigns workers to nearest node, sends raiders at
      blue HQ once it has ≥ 3. No ML, no reactive targeting.
- [x] **Win / lose screen** — overlay shows `VICTORY` (blue) or `DEFEAT` (red)
      with a `PLAY AGAIN` button that resets match state in-place without a page
      reload.
- [x] **Mouse-driven end-to-end match** — a fresh match can be played from
      idle-start to victory/defeat **using only the mouse**: click HQ → pick
      buildable → click tile to place → click unit to select → click tile to
      move → engage red → reach `WIN_POINTS` or lose. No keyboard required.
- [x] **Onboarding cue** — on match start the player sees a floating prompt
      (e.g. "Click your HQ to begin") that clears once the first HQ-driven
      action happens. The match never opens with nothing clickable and no
      guidance.
- [x] **Visual concept-match** — latest `pm/screenshots/` visibly resemble
      `docs/concepts/` (dark field, accented neon on dark silhouettes, readable
      Tron shapes — **not** full-saturation glowing cubes). Scored against
      `pm/rubric.md` v2 (tightened thresholds); latest entry in `pm/scores/`
      must pass under v2.

## Reopen 2 — engagement & comprehension (2026-04-19T09:01:01Z)

Owner played the build end-to-end and won on points while doing almost
nothing. The opening onboarding cue fires, but after that the game does not
teach itself and combat does not actually reach across the map. Five gaps,
all must be ticked to re-close MVP:

- [x] **Offensive reach** — raiders (or a designated offensive unit) can
      cross the map and engage enemy units or the enemy HQ. "Place at blue
      HQ and shoot nearby" is not enough. Either (a) raiders auto-path
      toward nearest enemy once placed, (b) an attack-move click target
      exists, or (c) placement can happen anywhere reachable by the
      player. Playwright scene proves a raider placed from idle-start
      reaches the red side and exchanges fire. No A*, straight-line tile
      hops are fine.
- [x] **Idle is a losing strategy** — tune `BASE_INCOME`, `NODE_INCOME`,
      kill/HQ-damage point rates, and AI build-order cadence so that a
      player who places nothing after the HQ-click onboarding cue loses
      the match against the default AI. Playwright regression proves it.
- [x] **Tooltips — buildables + nodes** — hover on each buildable shows
      name + cost + one-line role (what Worker/Defender/Raider actually
      does). Hover on an energy node shows a short label ("Energy node —
      park a worker to boost income"). DOM-driven, matches existing HUD
      chrome (mono font, cyan outline, dark panel).
- [x] **Worker behaviour legibility** — blue and red workers share the
      same idle animation. Worker-on-node either (a) has a visibly
      readable harvest tick (pulse/beam on income tick) or (b) is static
      with no jitter. Current random motion is forbidden. Both factions
      behave identically.
- [x] **Event feedback pulses** — unit placement, unit death, node
      capture, and point-tick each trigger a brief visible cue (tile
      flash, scale pulse, number flash, or equivalent). No sound engine
      required. Screenshot of mid-combat shows at least one live event
      cue in-frame.

### What 'resolved' looks like

A cold-start player (the owner, no instruction) can play a full match and
in real time understand: what the hexes are, what each buildable does,
why workers move, how to actually attack the enemy, and why they won or
lost. Raiders reach the enemy side. Doing nothing loses. Tooltips exist
on the buildables panel and on energy nodes. Updated `pm/screenshots/`
show mid-match state that reads as an RTS in progress.

## Reopen 3 — worker task model, placement, map layout (2026-04-20T19:20:18Z)

Owner follow-up to reopen-2. Workers move up/down on nodes with no readable
reason, placement is stuck in strict adjacency (so surrounding the HQ with
defenders blocks Raider training), energy nodes look blue-owned at rest,
and the HQ layout (top/bottom, flush with corner) doesn't match the
concept. Six directives, all must be ticked to re-close MVP:

- [x] **Map layout — left vs right, HQ inset 3 tiles** — blue HQ sits on
      the left side of the grid, red HQ on the right, each inset 3 tiles
      from the map edge (not flush with the corner) so the HQ proximity
      zone fits on the playfield on the HQ's own side. Existing Playwright
      scenes updated — not deleted — to pass under the new layout.
- [x] **Proximity placement (7×7 zone around HQ)** — building placement
      uses a proximity zone of 3 tiles in every direction around the HQ
      (7×7 area centred on HQ, minus the HQ tile itself) rather than
      strict adjacency. With a buildable selected the zone is visibly
      previewed (ghost highlight). Placement outside the zone is
      rejected with clear feedback.
- [x] **HQ spawn point** — each HQ has a designated spawn point (a single
      tile near the HQ). Selecting the HQ shows the spawn point. Training
      a Worker/Defender/Raider spawns the unit at HQ and it immediately
      moves to the spawn point (so a fully-walled HQ can still train
      Raiders). Spawn point is relocatable by clicking the HQ then a
      valid nearby tile.
      *(Superseded by reopen-5: spawn-point UI reverted; spawn-adjacent-to-HQ
      reinstated, with HQ-enclosure guarded at placement time. Kept ticked for
      audit trail.)*
- [x] **Worker task loop — walk → harvest buffer → walk-back → offload** —
      workers assigned to a node walk there, harvest into a local buffer
      over time (animated fill), walk back to HQ, offload into the player's
      energy pool (animated), and repeat. This replaces the "stand on
      tile → passive tick" passive model with a watchable loop. Economy
      source is still node→energy; just routed through the worker.
- [x] **Exhaustible nodes + one-worker-per-node** — nodes have a finite
      reserve that drains as workers harvest. An empty node visibly dims
      (no faction tint, dead-look) and workers auto-seek the nearest live
      node. At most one worker can occupy a node at a time; a second
      worker pathing to an occupied node re-targets to the next-nearest
      live node (prefer re-target over wait).
- [x] **Energy node visuals — neutral at rest, faction-tinted while
      harvested** — idle nodes read as neutral/unclaimed (white-core,
      faint neutral glow), and only tint toward blue/red while a faction's
      worker is actively harvesting. Live vs exhausted must be visually
      obvious. Replaces current fully-blue-looking nodes.

### What 'resolved' looks like (reopen 3)

Owner can assign a blue worker to an energy node and watch it walk there,
fill a buffer, walk back to HQ, and offload — repeatedly, until the node
exhausts and visibly dims. Two workers cannot share a node. Energy nodes
read as neutral at idle and only colour under active harvest. Owner can
wall the HQ with defenders and still train a Raider that spawns at HQ
and moves to a repositionable spawn point. A buildable ghost preview
shows the 7×7 proximity zone around the HQ. Match opens with blue HQ on
the left and red HQ on the right, each inset 3 tiles from the edge, and
the proximity zone fits without clipping. `pm/screenshots/` regenerated
and still pass rubric v2.

## Reopen 4 — AI worker parity, node occupancy release, node regeneration (2026-04-19T23:10:04Z)

Owner flagged three basic-RTS parity bugs in
`pm/inbox/2026-04-19-bugs-worker-behaviour.md`. The reopen-3 worker task
loop was only wired for the player — AI workers still harvest passively on
the tile, node occupancy is "for life", and nodes exhaust with no
regeneration path. All three must be ticked to re-close MVP:

- [x] **AI worker parity — same walk/harvest/walk-back/offload loop as
      player** — red workers follow the identical task loop: path to a
      live node, harvest into a local buffer, path back to the red HQ,
      offload into red's energy pool, repeat. No direct-on-tile passive
      income for AI. Worker rules are faction-agnostic; only task
      assignment differs (player manual, AI automatic). Playwright scene
      proves a red worker visibly travels from node to red HQ and back.
- [x] **Node occupancy releases when the worker leaves** — a node's
      occupancy is cleared the moment its assigned worker departs (to
      offload, to seek a new node, on death, or on reassignment). Another
      worker — either faction — can claim the node immediately after
      release. Workers en route to a now-occupied node re-target to the
      nearest unoccupied live node rather than waiting. Applies to both
      factions. Playwright proves worker A harvests → leaves to offload →
      worker B immediately claims the same node.
- [x] **Nodes regenerate after exhaustion** — exhausted nodes slowly
      refill their reserve over time and become eligible to harvest again
      once reserve ≥ a small minimum. Collection rate must remain
      dominant: regeneration rate is at least 5× slower than worker
      collection rate, so regen never carries the economy but dead zones
      recover. Visuals: exhausted node stays "dead" until it crosses the
      re-eligible threshold, then returns to the neutral-at-rest look.
      Playwright scene or unit test proves an exhausted node returns to
      life without human intervention.

### What 'resolved' looks like (reopen 4)

Owner watches a match where both blue and red workers follow the same
visible walk→harvest→walk-back→offload loop. A red worker leaving its node
to offload frees that node for another worker (of either faction) to
claim. An exhausted node visibly dims and later, unattended, comes back
to life and is harvested again. Nothing in the player's worker behaviour
changes. `pm/screenshots/` regenerated and still pass rubric v2.

## Reopen 5 — combat balance + spawn-point UX revert (2026-04-20T21:00:00Z)

Owner ran the build with playtesters. Reopen-4 landed at 7/10 — a solid
jump — but two clusters now block the next round: a UX regression from
the spawn-point mechanism and a combat-loop that reads as broken in
both directions. Six directives, all must be ticked to re-close MVP:

- [x] **Revert spawn-point mechanism — spawn adjacent to HQ** — kill the
      HQ-select → spawn-point-select placement flow. Training a Worker /
      Defender / Raider spawns the unit on a free tile **adjacent to HQ**
      (pre-spawn-point behaviour). No spawn-point UI, no two-step
      ritual — selecting the HQ must not drop the player into a spawn-
      marker placement mode. Playwright scene proves training a unit
      from fresh HQ select yields the unit adjacent to HQ with zero
      extra clicks.
- [x] **HQ-enclosure guard at placement time** — the reason spawn-point
      existed was to let a fully-walled HQ still train. Solve it at
      placement instead: if placing a building/unit on a given tile
      would leave the HQ with **zero free adjacent tiles**, reject the
      placement. Applies to every placeable that could occupy an
      HQ-adjacent tile, both factions. Show a clear "can't place" cue on
      the offending tile (tile flash / red outline / equivalent — PM +
      engineer pick). Playwright proves: attempting to wall the final
      HQ-adjacent tile is rejected with a visible cue, and Raiders still
      train.
- [x] **Combat balance — fights last long enough to be fights** —
      rebalance HP / damage / attack cadence so (a) a raider vs a worker
      is a short but legible exchange (worker isn't 1-shot), and (b) a
      defender vs a raider is an actual fight (raider doesn't evaporate
      on contact). Exact numbers are engineer's call. Playwright proves
      both matchups take ≥ N frames / ticks to resolve (N chosen such
      that a tester *sees* the fight, not just the aftermath).
- [x] **Raider damage pipeline against defenders + HQ** — raiders must
      deal visible damage to both defenders and the HQ. Fix whatever in
      the combat tick / HP pipeline currently drops raider-vs-defender
      and raider-vs-HQ hits. Damage must be legible (HP bars shrink, HQ
      HP visibly drops). Playwright proves: a raider engaging a defender
      visibly reduces defender HP, and a raider reaching HQ visibly
      reduces HQ HP.
- [x] **Raider targeting priority — retaliate then nearest** — replace
      the "beeline to HQ, ignore everything" behaviour with a priority
      stack per raider: (1) if a defender has damaged this raider in
      the last N ticks → retaliate on that defender until it is dead or
      out of range, (2) otherwise target the **nearest** of {worker,
      defender, HQ}. HQ remains a valid target; it just isn't the
      default. Playwright proves: poking a raider with a defender pulls
      the raider off its HQ beeline; with no aggressor around, raiders
      go for nearest worker / defender, not HQ-by-default.
- [x] **Damage + HP feedback — bars shrink per hit + damage-taken cue** —
      HP bars must visibly shrink on each hit, not only at death. Every
      damaged unit (worker / defender / raider / HQ) also shows an on-
      unit damage cue — flash, particle burst, or equivalent (engineer
      picks what reads best). No audio, no new mesh systems. Playwright
      mid-combat screenshot shows at least one in-progress HP bar (<100%,
      >0%) and at least one active damage-taken visual.

### What 'resolved' looks like (reopen 5)

Owner trains a worker / defender / raider and it appears adjacent to HQ
without touching a spawn point. Selecting HQ never puts the owner into
spawn-marker mode. Owner tries to wall HQ with buildings — the last
HQ-adjacent tile rejects placement with a clear cue, and Raiders can
still train. Worker-vs-raider and raider-vs-defender exchanges both
last long enough to read as fights. Raiders visibly damage defenders
and HQ with HP bars shrinking on each hit. Poking a raider with a
defender pulls it off its HQ beeline into a retaliation. A raider with
no aggressor around goes for the nearest worker / defender / HQ — not
HQ-by-default. Every damaged unit shows a live HP-bar update and a
damage flash / particle cue. `pm/screenshots/` regenerated and still
pass rubric v2.

## Reopen 6 — HP contrast, raider damage vs workers, defender proximity, node invariant (2026-04-20T06:06:27Z)

Owner follow-ups after reopen-5 landed. Four issues in play: HP bars are
dark-on-dark and nearly invisible, raiders still two-shot workers despite
reopen-5 #3, defenders regressed to strict-adjacency placement (reopen-3
#5 regression), and the one-worker-per-node rule breaks under heavy
traffic with no HQ-idle fallback. All four must be ticked to re-close MVP:

- [ ] **HP bars — readable on every unit, every tile, every faction** —
      fix the dark-on-dark contrast so per-unit HP bars read at a glance.
      Engineer picks the approach (brighter fill, high-contrast
      background pill, outline, or equivalent) but the result must be
      legible on worker / defender / raider / HQ, both factions, over
      any tile colour. Playwright mid-combat screenshot shows HP bars
      clearly distinguishable from the ground/units behind them.
- [ ] **Raider-vs-worker hard floor — worker survives ≥5 raider hits** —
      rebalance raider damage vs worker HP so a worker takes **at least
      5 hits from a raider** before dying. Exact tuning is engineer's
      call; the floor is load-bearing. Playwright proves: seed one
      raider engaging one worker, assert hit count ≥5 at death.
      Must not break reopen-5's raider-vs-defender and raider-vs-HQ
      balance — re-run existing combat assertions.
- [ ] **Defender placement — HQ proximity zone, not adjacency** —
      defenders place on any free tile inside the 7×7 HQ proximity zone
      (reopen-3 #5), not only HQ-adjacent tiles. Same rule as Worker /
      Raider / other buildables. Ghost-preview must show defender placement
      over the full zone. Playwright proves: placing a defender on a non-
      adjacent proximity-zone tile succeeds; placing outside the zone
      is rejected with the existing "can't place" cue.
- [ ] **One-per-node invariant + HQ-idle fallback for workers** — the
      one-worker-per-node rule must hold under any traffic pattern (no
      two workers ever occupy the same node at the same time, even
      after repeated back-and-forth trips, re-target thrash, or
      reassignment). If a worker has no live unoccupied node to target
      (all nodes occupied or exhausted), it walks back to HQ and idles
      there instead of thrashing between occupied nodes or stalling
      mid-map. Both factions. Playwright proves: (a) stress scene with
      N workers and M<N live nodes asserts no two workers share a node
      at any tick, (b) scene with all nodes occupied proves the N+1th
      worker returns to HQ and idles.

### What 'resolved' looks like (reopen 6)

Owner opens a match and HP bars are clearly readable over any tile / unit
background, both factions. Sending one raider at one worker takes ≥5 hits
to kill the worker and reads as a fight, while raider-vs-defender and
raider-vs-HQ still land their reopen-5 legibility. Armed with the
defender buildable, the full HQ proximity zone highlights as valid
(not just HQ-adjacent tiles) and placement on any free proximity tile
succeeds. In a match with dense worker traffic, no two workers ever
share a node; when every node is occupied or exhausted, extra workers
walk back to HQ and idle instead of stalling. `pm/screenshots/`
regenerated and still pass rubric v2.

## Non-goals (explicitly deferred)

- Fog of war, minimap, selection box, A* pathfinding, multiplayer, sound,
  procedural maps, unit upgrades, tech tree, multiple factions beyond red/blue,
  save/load, persistent leaderboard. Do **not** build any of these for MVP.

## Constants (current values — engineer may tune, PM may renegotiate)

| Name           | Value | Meaning                                          |
| -------------- | ----- | ------------------------------------------------ |
| `GRID_SIZE`    | 20×20 | Playable grid dimensions.                        |
| `BASE_INCOME`  | 1/s   | Trickle energy per faction, always.              |
| `NODE_INCOME`  | 3/s   | Extra energy per worker standing on a node.      |
| `WORKER_COST`  | 20    | Energy to train a worker.                        |
| `DEFENDER_COST`| 60    | Energy to train a defender.                      |
| `RAIDER_COST`  | 100   | Energy to train a raider.                        |
| `WIN_POINTS`   | 500   | First faction to hit this wins.                  |
| `NODE_REGEN_RATE`       | 0.4/s | Reserve regen rate for exhausted nodes (5× slower than harvest). |
| `MIN_REGEN_THRESHOLD`   | 6     | Reserve minimum before an exhausted node is eligible again.      |
| `WORKER_HP`             | 80    | Worker health points (ceil(80/15)=6 raider hits to kill). |
| `DEFENDER_HP`           | 120   | Defender health points (8 raider hits to kill).  |
| `RAIDER_HP`             | 60    | Raider health points (4 defender hits to kill).  |
| `RAIDER_DAMAGE`         | 15    | Raider damage per hit (reduced from 20 to give workers ≥5-hit floor). |
| `DEFENDER_DAMAGE`       | 15    | Defender damage per hit.                         |
| `RETALIATE_WINDOW_TICKS`| 4     | Raider retaliates on last attacker for this many combat ticks. |

## How we know it's done

PM runs the match end-to-end via Playwright in a scripted scene, captures
screenshots at key moments (idle start, mid-game, victory screen), scores them
against `rubric.md`, and the score meets threshold. Then — and only then — flip
`status` above to `complete`.
