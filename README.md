# Vylux

A Tron-inspired isometric real-time strategy game, designed from the ground up to be **deterministic, replayable, and competitively spectated** — a 1v1 RTS aimed at Steam release with a credible esport footprint.

- **Product direction:** [`docs/product/PRD.md`](docs/product/PRD.md)
- **Phase 1 closed:** [`docs/investigation/02-phase-1-sim-rewrite.md`](docs/investigation/02-phase-1-sim-rewrite.md) — deterministic sim + Three.js renderer + click-to-place + replay format + cross-OS CI gate
- **Aesthetic references:** [`docs/concepts/`](docs/concepts/)
- **Module layout:** [`AGENTS.md`](AGENTS.md)

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

This is the same gate used locally and in CI — no CI-only variants.

## Status

Phase 0 (deterministic spike) and Phase 1 (sim rewrite + Three.js renderer + click-to-place + click-to-select + replay format) are closed. Cross-OS determinism CI is green on every push. The dev build is playable mouse-only against the scripted AI: click a buildables button → click a tile to spawn the unit there; click your own worker → click a node to assign harvest. Phase 2 (multiplayer alpha) is up next — see the investigation doc for scope.
