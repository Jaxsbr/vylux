/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

const PORT = 5180;

export default defineConfig({
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
