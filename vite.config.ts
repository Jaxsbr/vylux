/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

const PORT = 5180;

// `VITE_BASE` lets the GitHub Pages workflow build with a project-page
// base path (`/vylux/`) without disturbing local dev, the playwright
// preview project, or the determinism CI — all of which keep `/`.
const BASE = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base: BASE,
  server: {
    port: PORT,
    strictPort: true,
  },
  preview: {
    port: PORT + 1,
    strictPort: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
  },
});
