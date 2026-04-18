## Phase retrospective — foundation

**Metrics:** 23 tasks, 20 investigate, 0 fail, 0 rework. Rework rate: 0%. Investigate ratio: 87%. Health: Healthy.

Breakdown:
- Build tasks 1–18: each passed on first execute (investigate → Branch A → verify → commit). Task 1 paused mid-step for an environmental npm-install permission approval — not counted as a failure (operator resolved the permission, re-entry passed).
- Task 19: Phase Completion Gate — ticked 57 done-when boxes + retroactive Story Completion Gate for US-01..US-05 + flipped `phase_complete: true`.
- Tasks 20–23: Review stage — PR #1 opened, review-pr posted 5 inline comments (0 Critical, 2 Concern, 3 Nit), handle-pr-review fixed 2 Concerns with comment-only contract annotations and skipped 3 nits per reviewer's own guidance, `review_complete: true`.

**Build-log failure classes:** none.

**Review-sourced failure classes:**
- `missing-contract-annotation` — first-seen (2 Concerns: `src/scene.ts:233` reconcile placed-mesh loop had no inline comment on its append-only contract, leaving a future undo/delete phase free to silently drift state from scene; `src/placement.ts:161` handleClick's null-hit-exits-idle vs. out-of-bounds-stays-in-placement asymmetry was intentional UX but uncommented, so a well-meaning "simplification" could collapse the branches). Fix landed in `15da0a4` (comment-only). No compounding action per twice-seen rule.

**Build-loop observations (first-seen; not triggering compounding):**
- `build-loop-story-gate-silent` — the Story Completion Gate defined in `build-loop-iterate/SKILL.md` Branch A (Step 8) did not produce `feat(US-XX): complete ...` milestone commits during tasks 1–18; all 5 milestones had to be generated retroactively in the Phase Completion Gate (commits `8727035`, `792d21a`, `1dba855`, `bbd0787`, `c3bb8cb`). Functionally equivalent — same criteria met, same tests, same shipped code — but removes an observability guarantee the skill promises. Worth monitoring next phase: if the same gap recurs, compound by adding an explicit gate-fire log line to Branch A so missing milestones are detectable in `log/<phase>.yaml`.

**Compounding fixes proposed:** No compounding fixes (all classes first-seen; the twice-seen rule defers action until a second occurrence).

### Context

- Consistent "pure-first split" delivery pattern across every user story: (a) pure state + Vitest, (b) scene reconciliation + debug surface, (c) input wiring + Playwright. Resulted in a 0% rework run and strong test coverage (79 Vitest + 16 Playwright = 95 tests).
- State-ownership contract enforced compile-time (module imports) + runtime (Playwright debug hook) + source-scan (`src/source-scan.test.ts` greps for bare catches). Held across all 23 tasks.
- 6 visual "reads as" criteria were isolated to `docs/manual-verification/foundation.md` with operator sign-off required before phase close — clean separation of mechanically-verifiable and subjective criteria. Operator (Jaco) signed off 2026-04-18.
- Retro was run pre-emptively once before phase close (producing the `retro_complete: true` state ahead of `phase_complete: true`, which then tripped the iterate state-consistency check). This is captured in the build-loop flow as `chore: defer retro_complete until phase_complete flips` (`bc2cb05`) — noted for future phases: don't run phase-retro until the phase has actually completed.
