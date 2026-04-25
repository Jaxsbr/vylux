# Vylux

A Tron-inspired isometric real-time strategy game, designed from the ground up to be **deterministic, replayable, and competitively spectated** — a 1v1 RTS aimed at Steam release with a credible esport footprint.

- **Product direction:** [`docs/product/PRD.md`](docs/product/PRD.md)
- **Active investigation:** [`docs/investigation/00-determinism-and-netcode.md`](docs/investigation/00-determinism-and-netcode.md)
- **Aesthetic references:** [`docs/concepts/`](docs/concepts/)
- **Module layout (current code):** [`AGENTS.md`](AGENTS.md)

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

The repository currently contains a working prototype (single map, three unit types, one scripted AI). It is being **rebuilt around a deterministic simulation core** before further feature work — see the investigation doc above for the gating spike.
