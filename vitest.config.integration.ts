import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['src/**/*.integration.spec.ts'],
    // Estos specs comparten la misma base de datos: ejecutarlos en paralelo
    // hace que se pisen entre sí.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    globalSetup: ['./vitest.integration-setup.ts'],
  },
});
