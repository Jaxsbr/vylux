# Vylux

A Tron-inspired isometric real-time strategy game, designed from the ground up to be **deterministic, replayable, and competitively spectated** — a 1v1 RTS aimed at Steam release with a credible esport footprint.

- **Product direction:** [`docs/product/PRD.md`](docs/product/PRD.md)
- **Active investigation:** [`docs/investigation/02-phase-1-sim-rewrite.md`](docs/investigation/02-phase-1-sim-rewrite.md) (sub-phases 1.0–1.6 landed; **1.7 input-depth pending** before Phase 1 closes)
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

The deterministic simulation core (Phase 0) and the prototype-equivalent sim rewrite (Phase 1, sub-phases 1.0–1.6) have landed. The cross-OS determinism gate is green on every push. The current dev build is technically playable against the AI but offers limited spatial input — sub-phase 1.7 in the investigation doc tracks restoring click-to-place and click-to-select-and-move-worker before Phase 1 truly closes.
