# Vylux — Product Requirements Document

## Vision

A 3D isometric real-time strategy game — an Age of Empires-like builder inspired by the novel and movie *Tron*. Players compete for resources on a neon-contrasting grid (red-orange vs. blue on dark), building, gathering, sabotaging opponents, and racing toward supremacy.

This document is the **index**. Full story detail lives in per-phase spec files under `docs/product/phases/<phase-name>.md`.

## Implementation Phases

| Phase | Status | Stories | Spec |
|---|---|---|---|
| foundation | Draft | US-01, US-02, US-03, US-04, US-05 | [phases/foundation.md](phases/foundation.md) |

## Story ID convention

- `US-NN` zero-padded two-digit IDs, allocated in the per-phase spec file that introduces them.
- IDs are never reused. Next available ID after `foundation`: `US-06`.
- Deferred stories live in `docs/product/backlog.md` (created when the first deferral happens).

## Backlog pointers (scoped out so far)

From the foundation phase's "Scoped out" section, these are known follow-ups for future phases:

- On-screen mode indicator (HUD label for current placement faction).
- Remove / replace / undo placement.
- CI workflow (`.github/workflows/ci.yml`) — candidate for a `ci-bootstrap` phase before phase 3.
- Cache-control headers on the built shell.
- WebGL context-loss user-visible recovery UI.
