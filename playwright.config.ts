import { defineConfig } from '@playwright/test';

const DEV_PORT = 5180;
const PREVIEW_PORT = 5181;
const SIGNALING_PORT = 5182;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  projects: [
    {
      name: 'dev',
      testMatch: [
        'smoke.spec.ts',
        'mouse.spec.ts',
        'select.spec.ts',
        'lockstep.spec.ts',
        'lockstep-webrtc.spec.ts',
        'lockstep-desync.spec.ts',
        'lockstep-replay.spec.ts',
        'lockstep-observer.spec.ts',
      ],
      use: { baseURL: `http://localhost:${DEV_PORT}` },
    },
    {
      name: 'preview',
      testMatch: ['preview.spec.ts'],
      use: { baseURL: `http://localhost:${PREVIEW_PORT}` },
    },
  ],
  webServer: [
    {
      command: 'npm run dev',
      port: DEV_PORT,
      reuseExistingServer: true,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 60_000,
    },
    {
      command: 'npm run build && npm run preview',
      port: PREVIEW_PORT,
      reuseExistingServer: true,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 120_000,
    },
    {
      // Lockstep signaling relay — required for ?room=... WebRTC mode.
      // Tiny Node.js process, dormant once peers' datachannels open.
      command: `PORT=${SIGNALING_PORT} npm run signaling`,
      port: SIGNALING_PORT,
      reuseExistingServer: true,
      stdout: 'ignore',
      stderr: 'pipe',
      timeout: 30_000,
    },
  ],
});
