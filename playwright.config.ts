import { defineConfig } from '@playwright/test';

const PORT = 5180;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
  },
  webServer: {
    command: 'npm run dev',
    port: PORT,
    reuseExistingServer: true,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 60_000,
  },
});
