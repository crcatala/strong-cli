import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/cli.ts'],
      // Honest thresholds for the current suite (run in CI):
      //     all files  69.4 stmts / 77.8 branch / 77.2 funcs / 69.4 lines
      // The gap is `src/commands` (43%) — add command-level tests to raise.
      thresholds: {
        statements: 60,
        branches: 70,
        functions: 70,
        lines: 60,
      },
    },
  },
})
