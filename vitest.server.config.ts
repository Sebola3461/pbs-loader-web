import { defineConfig } from 'vitest/config';

// Testes do servidor (Pages Functions): rodam no Node, fora do builder do Angular.
export default defineConfig({
  test: {
    include: ['server/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['server/**/*.ts'],
      exclude: ['server/**/*.test.ts', 'server/testing/**'],
      reporter: ['text'],
    },
  },
});
