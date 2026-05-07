// Standalone signaling server entrypoint.
//
// Usage:
//   npx vite-node tools/signaling-server.ts        # default port 5182
//   PORT=8080 npx vite-node tools/signaling-server.ts
//
// Deployment: any Node.js host that supports WebSockets. The free tiers
// suggested in investigation 03 (Render, Fly, Railway) all do. Set the
// PORT env var to whatever the platform exposes.

import { startSignalingServer } from '../src/net/signaling-server';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 5182;
const host = process.env.HOST;

startSignalingServer({ port, host }).then((server) => {
  console.log(`[signaling] ready on port ${server.port}`);

  const shutdown = (signal: string) => {
    console.log(`[signaling] received ${signal}, shutting down`);
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}).catch((err: Error) => {
  console.error('[signaling] failed to start:', err);
  process.exit(1);
});
