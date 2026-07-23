import { defineConfig } from "vitest/config";

export default defineConfig({
  // Vite resuelve los alias de tsconfig ("@/…") de forma nativa
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    // Los E2E de Playwright tienen su propio runner
    exclude: ["tests/e2e/**", "node_modules/**"],
    setupFiles: ["tests/setup.ts"],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      include: ["lib/**/*.ts"],
      exclude: ["lib/**/*.d.ts"],
    },
  },
});
