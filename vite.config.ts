/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

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
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        v2: resolve(__dirname, 'index-v2.html'),
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    passWithNoTests: false,
  },
});
