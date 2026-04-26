# Vylux

A Tron-inspired isometric real-time strategy game, designed from the ground up to be **deterministic, replayable, and competitively spectated** — a 1v1 RTS aimed at Steam release with a credible esport footprint.

## Picking up work in a new session

Read these in order:

1. **`docs/product/PRD.md`** — vision, pillars, phases 0–5, scope. The product anchor.
2. **`AGENTS.md`** — current module layout, the determinism contract, what's load-bearing in the code.
3. **The latest investigation doc** — what's currently being worked on. `docs/investigation/` is numbered chronologically; the highest-numbered open one is the current frontier. Each doc owns scope, sub-phases, exit criteria, decision log, and (after closing) the lessons learned.

The convention: **every PRD phase gets one investigation doc** when it starts. Phase 3+ stays at PRD §8 detail until its phase opens.

## Phase status

| Phase | Status | Doc |
|---|---|---|
| 0 — Determinism Spike | ✅ Closed | [`docs/investigation/00-determinism-and-netcode.md`](docs/investigation/00-determinism-and-netcode.md) |
| 0 audit (sub-investigation) | ✅ Closed | [`docs/investigation/01-nondeterminism-audit.md`](docs/investigation/01-nondeterminism-audit.md) |
| 1 — Sim Rewrite | ✅ Closed | [`docs/investigation/02-phase-1-sim-rewrite.md`](docs/investigation/02-phase-1-sim-rewrite.md) — includes Lessons section |
| **2 — Multiplayer Alpha** | **▶ Active (next)** | [`docs/investigation/03-phase-2-multiplayer-alpha.md`](docs/investigation/03-phase-2-multiplayer-alpha.md) |
| 3 — Faction & Map Depth | Future (PRD §8) | n/a until Phase 2 closes |
| 4 — Steam Early Access | Future (PRD §8) | n/a |
| 5 — Ladder & Esport Hooks | Future (PRD §8) | n/a |

## Quick start

```bash
npm install
npm run dev        # http://localhost:5180/
```

Build and preview the production bundle:

```bash
npm run build
npm run preview    # http://localhost:5181/
```

## Verify

```bash
npx tsc --noEmit && npm run test && npm run test:e2e
```

Same gate used locally and in CI. The cross-OS determinism workflow (`.github/workflows/determinism.yml`) runs the same `npm test` on Linux + macOS + Windows on every push and validates against the committed golden hash fixtures in `tests/determinism/`.

## What runs today

The dev build is a 1v1 RTS playable mouse-only against the scripted AI on the deterministic sim:

- Click WORKER / DEFENDER / RAIDER on the buildables panel → unit trains and spawns at the HQ on the next sim tick.
- Click your own worker → selection ring appears → click a live energy node → that worker walks there to harvest.
- Esc / right-click clears selection.
- Match ends on HQ destruction or 100-point threshold; VICTORY/DEFEAT overlay with Play Again.

Replays exist (`src/sim/replay.ts`) and can be played headless via `npx vite-node tools/replay.ts <replay.json>`.

## Aesthetic references

[`docs/concepts/`](docs/concepts/) — Tron-inspired neon-on-charcoal screenshots used as the visual anchor.
