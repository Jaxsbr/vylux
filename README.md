# Vylux

A 3D isometric real-time strategy game — an Age of Empires-like builder inspired by *Tron*. Players compete for resources on a neon-contrasting grid (red-orange vs. blue on dark), building, gathering, sabotaging opponents, and racing toward supremacy.

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

Run the full verify command (matches the build-loop gate):

```bash
npx tsc --noEmit && npm run test && npm run test:e2e
```

User manual: [docs/manual/foundation.md](docs/manual/foundation.md).

<!-- build-loop -->
---
*Built with [build-loop](docs/plan/) — init v13*
