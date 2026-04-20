---
id: combat-rebalance-targeting-feedback
opened_at: 2026-04-20T21:05:00Z
status: done_by_engineer
priority: P0
---

# Combat rebalance + raider damage pipeline + retaliate-then-nearest + HP-bar & damage feedback

## Outcome

Combat reads as combat. A raider meeting a worker is a short but visible
exchange, not a 1-shot. A defender meeting a raider is an actual fight.
Raiders visibly damage defenders **and** the HQ — the pressure-valve of
the match finally functions. Raiders no longer autopilot to the HQ while
a defender is in their face; poke one with a defender and it turns and
fights back. With no aggressor around, raiders go for the nearest
target (worker / defender / HQ) — HQ is valid, just not default. Every
damaged unit shows a visible HP-bar update on each hit and a damage-
taken flash/particle cue on the unit itself.

## Acceptance

### Directive 3 — balance: fights last long enough to read as fights

- Tune HP / per-hit damage / attack cadence for Worker, Defender, Raider,
  HQ so that:
  - A raider attacking a worker takes **≥ 3 visible hits** before the
    worker dies (worker is not 1-shot; the hit exchange is legible).
  - A defender attacking a raider takes **≥ 3 visible hits** before the
    raider dies (raiders do not evaporate on contact).
  - HQ still dies eventually to sustained raider pressure — do not buff
    HQ so high that raids feel pointless.
- Exact numbers are your call. Tune via constants (don't scatter magic
  numbers). Prefer raising HP / softening damage over slowing attack
  cadence — the game should feel faster than the previous pace.
- Playwright proves: a raider-vs-worker scene takes ≥ 3 combat ticks
  before the worker dies; a defender-vs-raider scene takes ≥ 3 combat
  ticks before the raider dies.

### Directive 4 — raider damage against defenders + HQ

- Raiders currently appear to do no (or no observable) damage to
  defenders or the HQ. Diagnose and fix whatever in the combat tick /
  HP pipeline / target filter drops those hits. The same damage path
  that raiders use against workers must also apply cleanly to defenders
  and to the HQ as a target.
- HQ HP decrements visibly on each raider hit. Defender HP decrements
  visibly on each raider hit. No special-casing of HQ that silently
  absorbs damage.
- Playwright proves: (a) a raider engaging a defender reduces the
  defender's HP bar across consecutive combat ticks and eventually kills
  it; (b) a raider reaching the enemy HQ reduces the HQ HP counter /
  bar visibly across consecutive combat ticks.

### Directive 5 — raider targeting priority: retaliate then nearest

- Replace the HQ-beeline behaviour. Per raider, each targeting re-eval
  picks in this order:
  1. **Retaliate:** if a defender has damaged this raider within the
     last `RETALIATE_WINDOW_TICKS` (engineer picks; ~2–5 combat ticks is
     reasonable), target that defender until it is dead or out of range.
     Retaliation outranks everything below. If multiple defenders have
     damaged this raider, pick the most-recent aggressor.
  2. **Nearest enemy** of {worker, defender, HQ} by tile-distance.
     Ties broken deterministically (your call — document the tiebreaker
     in a comment if non-obvious).
- HQ is in the nearest-target pool. It is **not** a default. A raider
  with a defender closer than the HQ goes for the defender.
- Applies to both factions' raiders if the AI uses raiders (currently
  red is the AI; the same logic must work for any future blue-raider-
  under-AI case — keep it faction-agnostic).
- Playwright proves: (a) a raider is placed/pathed toward the enemy
  HQ with a defender between it and the HQ — the raider engages the
  defender before the HQ; (b) a raider is placed with no defenders or
  workers around — it targets whichever enemy is nearest (may be HQ,
  may be a worker); (c) during combat a defender damages a raider — the
  raider turns to the defender, leaves its prior target, and engages
  until the defender dies or is out of range.

### Directive 6 — damage + HP feedback (per-hit HP shrink + damage flash)

- HP bars visibly shrink on **each hit**, not only at death. The HP
  bar width / fill must be a function of current HP vs max HP, updated
  every combat tick that lands a hit. No deferred updates, no
  end-of-animation snap.
- Every damaged unit (worker / defender / raider / HQ) shows an on-unit
  damage-taken cue on the tick a hit lands: flash (emissive spike),
  particle burst, scale pulse, or equivalent. Pick what reads best and
  matches the existing reopen-2 / reopen-3 event-pulse visual vocabulary
  (mono cyan / red-orange palette, brief duration). No audio, no new
  mesh systems.
- Playwright mid-combat screenshot shows at least one in-progress HP
  bar (> 0%, < 100%) and at least one active damage-taken visual
  in-frame.

### Cross-cutting

- All existing e2e + unit tests still pass (spawn-revert baseline = 368
  unit + 92 e2e green as of commit 17d81d4). Any balance / HP tuning
  that breaks existing assertions must be updated with intent, not
  hacked around.
- Regenerate `pm/screenshots/{idle-start,early-economy,mid-combat}.png`
  after changes land. Rubric v2 threshold must still hold (min 48 /
  per-axis 7). Mid-combat should read visibly *more* like an RTS fight
  post-change.
- The reopen-5 spawn-revert + HQ-enclosure guard (commit 17d81d4) must
  remain functional — do not regress adjacent-HQ spawn or the enclosure
  rejection cue while wiring combat.
- Reopen-3 / reopen-4 features (worker task loop, exhaustible +
  regenerating nodes, one-worker-per-node, AI-worker parity, neutral-
  at-rest node visuals) must remain functional.

## Constraints

- Faction-agnostic. The retaliate-then-nearest targeting and the damage
  feedback must apply to any raider regardless of faction.
- Tune via named constants (e.g. `WORKER_HP`, `RAIDER_DAMAGE`,
  `RAIDER_VS_HQ_DAMAGE`, `RETALIATE_WINDOW_TICKS`). Document them in
  `pm/mvp.md`'s Constants table if the names / values are load-bearing
  for acceptance — you may edit that table.
- Reuse the existing event-pulse / HP-bar infrastructure for the damage
  cue. Do not introduce a new FX pipeline, a new billboard system, or
  new audio hooks.
- If the current combat tick special-cases HQ (e.g. the HQ isn't in the
  unit list that raiders filter against), fix the filter or the data
  shape — do not paper over it with a duplicate HQ-targeting path.
- No new unit types, no new abilities, no pathfinding rewrite, no AI
  build-order rewrite beyond what the new targeting demands.
- Commit to local `main` with the full verify suite green. Do not push.
  Do not skip hooks. Fill in this file's Handoff section with a summary
  + commit SHA and flip `status: done_by_engineer` in its frontmatter.
- If you hit 5 failed attempts on the same sub-problem, stop and write
  `pm/learnings/engineer-<date>-<topic>.md` instead of grinding.

## Handoff

Commit SHA: (see below — filled after commit)

### What changed

**Directive 3 — Balance (≥3 hits per fight):**
- `src/units-config.ts`: raised `WORKER_HP` to 80 (4 raider hits), `RAIDER_HP` to 60 (4 defender hits), `DEFENDER_HP` to 120. Added named constants `WORKER_HP`, `DEFENDER_HP`, `RAIDER_HP`, `RAIDER_DAMAGE`, `RAIDER_VS_HQ_DAMAGE`, `DEFENDER_DAMAGE`, `RETALIATE_WINDOW_TICKS=4`.

**Directive 4 — Raider damage pipeline:**
- `src/combat.ts`: Expanded raider target pool from `{workers, HQ}` to `{workers, defenders, HQ}`. Fixed — the old code had `// target: workers + HQ only (not enemy defenders)` which was the root cause of zero raider-vs-defender damage.

**Directive 5 — Retaliate-then-nearest:**
- `src/combat.ts`: Added retaliation tracking. When a defender hits a raider it records the defender's `unitId` + the combat tick on the raider bundle. Raider targeting: if retaliating within `RETALIATE_WINDOW_TICKS`, target that defender first; otherwise nearest of `{workers, defenders, HQ}`.
- `src/advance.ts`: Rewritten to accept defenders array. Mirrors the same retaliation + nearest logic for the pathfinding phase. Reads retaliation state via `getRaiderRetaliation()` from `combat.ts`.
- `src/defender.ts`: Added `unitId` (monotonic counter) for retaliation matching. Added `triggerDamagePulse`/`tickDamagePulse`.
- `src/ai.ts`: Updated `advanceRaiders` call to pass blue defenders.

**Directive 6 — Per-hit HP-bar + damage flash:**
- `src/event-pulse.ts`: Added `DAMAGE_PULSE_DURATION=0.12s`, `DAMAGE_PULSE_PEAK_DELTA=5.0`.
- `src/raider.ts`, `src/defender.ts`, `src/worker.ts`, `src/hq.ts`: Added `triggerDamagePulse()`/`tickDamagePulse()`. `takeDamage()` already called `hpBar.update()` — HP bars already updated per-hit. The new pulse adds the emissive flash.
- `src/main.ts`: Added `tickDamagePulse` loop for all unit types and HQs.
- `src/e2e-hook.ts`: Updated `advanceRaidersFaction` calls to pass defenders.

### Tests
- 8 new e2e tests in `tests/e2e/combat-rebalance.spec.ts` covering all 4 directives.
- Updated `src/combat.test.ts` and `src/advance.test.ts` to match new behavior.
- Full verify: 380 unit + 100 e2e, all green.

### Screenshots regenerated
- `pm/screenshots/idle-start.png`
- `pm/screenshots/early-economy.png`
- `pm/screenshots/mid-combat.png` (updated to advance 2s for visible HP bars mid-fight)
