# Vylux

A Tron-inspired isometric real-time strategy game — a single-player **PvAI duel** on a deterministic simulation. You and an AI opponent each hold an HQ on a neon grid; grow an economy and (eventually) destroy the other HQ.

> **Where the project is.** Vylux was once aimed at competitive 1v1 multiplayer (Phases 0–3 were built against that goal), then repointed to single-player. The current effort is a deliberate **strip-and-polish**: the surface was cut back to its fun core — **HQ + Worker + Energy** — to be polished until the opening minutes are genuinely fun, after which combat units and the deeper economy return through a tech tree. The deterministic sim, Tron aesthetic, and renderer architecture all carry over. The lockstep / WebRTC / observer multiplayer code under `src/net/` is **dormant** — preserved for optionality, not on the active surface; don't extend it without re-pitching.
>
> The full direction and phase plan live in [`docs/plan.md`](docs/plan.md) — the single planning anchor.

## Picking up work in a new session

Read these three, in order:

1. **[`docs/plan.md`](docs/plan.md)** — the product direction and phase plan. The single planning doc: why the strip-and-polish, what each phase delivers, and the current sub-phase status. (Replaces the retired PRD + per-phase investigation series.)
2. **[`docs/manual.md`](docs/manual.md)** — the live catalog: every unit, structure, resource, research, control, and the current map, exactly as they exist in the build right now.
3. **[`AGENTS.md`](AGENTS.md)** — module layout, the determinism contract, and what's load-bearing in the code.

## Where we are

The phase ladder (detail in [`docs/plan.md`](docs/plan.md)):

- **A — Strip & Stabilise** ✅ — cut to HQ + Worker + Energy; HQ destruction is the only win.
- **B — Visual Reset** ✅ — the live build reads like the Tron concept art.
- **C — HQ + Worker Depth** ▶ — make the opening five minutes fun before any combat unit exists. Landed: the SC2-style HUD, synthesised audio, motion & world-life, the worker silhouette, the onboarding tutorial, and a bigger randomised map. Queued: sim-side obstacle avoidance, AI behaviour, the Matter economy + cost split, a resource depot, and research depth.
- **D — First Combat Unit** — introduce one combat unit, designed against the new tech tree.
- **E — Loop Closure** — the fun gate: enough matches that "start another?" lands as yes.

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

Same gate used locally and in CI. The cross-OS determinism workflow (`.github/workflows/determinism.yml`) runs `npm test` on Linux + macOS + Windows on every push and validates against the committed golden hash fixtures in `tests/determinism/`. Determinism is no longer load-bearing for the product, but it stays useful for save/load, replays-as-bug-reports, scripted scenarios, and reproducible AI testing — see [`AGENTS.md`](AGENTS.md).

## What runs today

A mouse-driven 1v1 RTS against a scripted AI on the deterministic sim. A Tron-styled main menu opens first: pick a faction (Swarm / Siege) to start a duel against the AI, or open the **TUTORIAL** sandbox.

- Your **HQ** trains **workers** (`W`), up to a supply cap and through a short production queue.
- Workers **harvest energy** — select a worker, then left-click an energy node; they gather, return, and deposit at the HQ.
- Workers **build work pods** (`B`) — a structure that raises the worker cap, recharges workers faster than the HQ, and hosts research.
- Each worker runs on an internal **charge** meter (one charge per task); at zero it walks to a pod (or HQ) to recharge and ignores commands until full.
- A work pod hosts the one current **research**, **Auto-Resume** (`R`) — charged workers then resume their last harvest target on their own.
- An SC2-style **command HUD**: resource bar (top); portrait, command card, and minimap (bottom). Fog of war hides the enemy until scouted; the minimap respects it and recentres the camera on click.
- Fully synthesised **audio** — an ambient bed plus a distinct cue per action; **M** mutes everything.
- Camera: **WASD** / arrow keys or middle-mouse drag to pan, scroll wheel to zoom.
- Press **R** (when nothing consumes it) or use the match-end overlay to **download the current replay** as JSON.
- A match ends on **HQ destruction** (or Resign). No combat units are in the active sim yet, so that path isn't reachable through normal play — it's the canonical win condition combat units route to once Phase D reintroduces them.

The current map is a 64×64 grid with a seeded, randomised energy field (~16 low/med/high-tier nodes). Full catalog + controls in [`docs/manual.md`](docs/manual.md).

Replays live in `src/sim/replay.ts` and can be played headless via `npx vite-node tools/replay.ts <replay.json>`.

### Dormant multiplayer modes

The Phase 2 lockstep / WebRTC / observer code still compiles and is exercised by tests, but it is **not the product direction**. Don't extend it without re-pitching the pivot.

- Two-tab lockstep: `?lockstep=host` / `?lockstep=join` over `BroadcastChannel`.
- WebRTC peer-to-peer: `npm run signaling`, then `?lockstep=host&room=ABCDEF` / `?lockstep=join&room=ABCDEF`.
- Observer prototype: `?lockstep=observe` while two players are running.

Details in [`AGENTS.md`](AGENTS.md).

## Aesthetic references

[`docs/concepts/`](docs/concepts/) — Tron-inspired neon-on-charcoal screenshots used as the visual anchor.
