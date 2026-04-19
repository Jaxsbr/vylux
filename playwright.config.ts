import { defineConfig } from '@playwright/test';

const DEV_PORT = 5180;
const PREVIEW_PORT = 5181;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  projects: [
    {
      name: 'dev',
      testMatch: ['foundation.spec.ts', 'smoke-dev.spec.ts', 'worker.spec.ts', 'training.spec.ts', 'combat.spec.ts', 'node-points.spec.ts', 'ai-opponent.spec.ts', 'win-lose.spec.ts'],
      use: { baseURL: `http://localhost:${DEV_PORT}` },
    },
    {
      name: 'preview',
      testMatch: ['preview.spec.ts'],
      use: { baseURL: `http://localhost:${PREVIEW_PORT}` },
    },
    {
      name: 'scenes',
      testMatch: ['scenes/*.spec.ts'],
      use: { baseURL: `http://localhost:${DEV_PORT}` },
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
  ],
});
