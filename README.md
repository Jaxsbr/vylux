# Vylux

A Tron-inspired isometric real-time strategy game — **single-player, PvE, wave-defense + roguelike-run shape**. Hold the grid against escalating raider waves; pick tech upgrades between waves; survive the run.

> **2026-05-07 — direction pivot.** Vylux was originally aimed at a competitive 1v1 ranked-ladder Steam release with esport hooks (Phases 0–3 were built against that goal). It has been repointed to single-player PvE. The deterministic sim, Tron aesthetic, and most of the catalog (units / structures / resources / fog / supply / action bar) carry over unchanged. The lockstep / WebRTC / observer multiplayer code under `src/net/` is **dormant — preserved for optionality, not on the active surface**. Don't add esport / ladder / spectator scaffolding without re-pitching the pivot. See `docs/product/PRD.md` for the new vision and `docs/investigation/04-phase-3-faction-and-map-depth.md` for the repointed sub-phases 3.11–3.14.

## Picking up work in a new session

Read these in order:

1. **`docs/product/PRD.md`** — vision, pillars, phases 0–5 (4 + 5 are now PvE: run-loop & meta-progression, then content + Steam stretch). The product anchor.
2. **`docs/manual.md`** — the current shipped catalog: units, structures, resources, tech, controls, current map. "What is in the game right now" vs the PRD's "what we're building toward."
3. **`AGENTS.md`** — current module layout, the determinism contract, what's load-bearing in the code. Note `src/net/` is dormant.
4. **The latest investigation doc** — what's currently being worked on. `docs/investigation/` is numbered chronologically; the highest-numbered open one is the current frontier. Each doc owns scope, sub-phases, exit criteria, decision log, and (after closing) the lessons learned.

The convention: **every PRD phase gets one investigation doc** when it starts. Phase 3+ stays at PRD §8 detail until its phase opens.

## Phase status

| Phase | Status | Doc |
|---|---|---|
| 0 — Determinism Spike | ✅ Closed | [`docs/investigation/00-determinism-and-netcode.md`](docs/investigation/00-determinism-and-netcode.md) |
| 0 audit (sub-investigation) | ✅ Closed | [`docs/investigation/01-nondeterminism-audit.md`](docs/investigation/01-nondeterminism-audit.md) |
| 1 — Sim Rewrite | ✅ Closed | [`docs/investigation/02-phase-1-sim-rewrite.md`](docs/investigation/02-phase-1-sim-rewrite.md) — includes Lessons section |
| 2 — Multiplayer Alpha | ✅ Closed (pre-pivot); now **dormant** — code preserved, not on the active surface | [`docs/investigation/03-phase-2-multiplayer-alpha.md`](docs/investigation/03-phase-2-multiplayer-alpha.md) |
| **3 — Faction & Map Depth (repointed PvE)** | **▶ Active — 3.0–3.10 closed; 3.11–3.14 repointed (enemy-AI faction → seedable maps → PvE win conditions → run-loop playtest)** | [`docs/investigation/04-phase-3-faction-and-map-depth.md`](docs/investigation/04-phase-3-faction-and-map-depth.md) |
| 4 — Run loop & meta-progression (PvE) | Future (PRD §8) | n/a |
| 5 — Content + optional Steam release | Future (PRD §8) | n/a |

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

Same gate used locally and in CI. The cross-OS determinism workflow (`.github/workflows/determinism.yml`) runs the same `npm test` on Linux + macOS + Windows on every push and validates against the committed golden hash fixtures in `tests/determinism/`. Determinism remains useful post-pivot for save/load, replays-as-bug-reports, scripted scenarios, and reproducible AI testing — see PRD §3.1.

## What runs today

The dev build is a 1v1 RTS playable mouse-only against the scripted AI on the deterministic sim. Until the Phase 3.11–3.14 PvE repoint lands, the live build still presents as "you vs an AI faction on a single hardcoded map" — i.e. the existing skirmish loop, not yet the wave-defense + roguelike-run shape the PRD now commits to.

- A Tron-styled main menu opens first; click **PLAY VS AI** to start a match.
- The action bar at the bottom is selection-driven: click your **HQ** for `TRAIN WORKER`; click a **worker** for `BUILD FORGE / SPIRE / PYLON` + `DUMP`; click a **Forge** for combat units; click a **Spire** for `RESEARCH TIER 2 / TRAIL+`. Workers stay idle on spawn until commanded.
- Workers build buildings — select a worker, pick `BUILD FORGE`, click a tile; the worker walks to the site and constructs it (visible "rising from the ground" + scaffolding ring while in build). Right-click an in-progress structure with workers selected to assign more builders.
- Click your own worker(s) → click a live energy / flux / colour node → all selected workers go harvest. Selection persists across orders; only an empty-space left-click clears it.
- Right-click on empty ground moves selected units. Faction-coloured ping at the target confirms the order; cursor changes to a crosshair while in placement mode.
- Fog of war shows the world as dark; your vision uncovers the bright Tron grid where you can see, mid-darkening it where you've explored but lost sight.
- Sound: UI click, train-complete, build-complete, attack-hit, HQ-alert. **M** toggles mute (top-right HUD indicator).
- WASD / arrow keys pan the camera; middle-mouse drag pans; scroll wheel zooms.
- Press **R** to download the current replay as JSON — useful for capturing bug-report material before a match ends. The match-end overlay also has a `DOWNLOAD REPLAY` button.
- Match ends on HQ destruction or 100-point threshold; VICTORY/DEFEAT overlay with Play Again + Download Replay.

Replays exist (`src/sim/replay.ts`) and can be played headless via `npx vite-node tools/replay.ts <replay.json>`.

### Dormant multiplayer modes

The Phase 2 lockstep / WebRTC / observer code still works and is exercised by tests, but it is **not the product direction**. Do not extend it without re-pitching the pivot.

- Two-tab lockstep: `?lockstep=host` / `?lockstep=join` over `BroadcastChannel`.
- WebRTC peer-to-peer: `npm run signaling`, then `?lockstep=host&room=ABCDEF` / `?lockstep=join&room=ABCDEF`.
- Observer prototype: `?lockstep=observe` while two players are running.

Details in `AGENTS.md` and the Phase 2 investigation doc.

## Aesthetic references

[`docs/concepts/`](docs/concepts/) — Tron-inspired neon-on-charcoal screenshots used as the visual anchor.
