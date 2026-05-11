import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks", // ESM-safe pool
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**", "src/middlewares/**"],
      exclude: ["src/lib/logger.ts"],
      // scope.ts MUST reach 100% branch coverage
      thresholds: {
        "src/lib/scope.ts": { branches: 100, functions: 100 },
        "src/lib/password.ts": { branches: 100, functions: 100 },
        "src/middlewares/auth.ts": { branches: 100, functions: 100 },
      },
    },
  },
  resolve: {
    alias: {
      // Workspace packages resolved to source for tests
      "@workspace/db": path.resolve(__dirname, "../../lib/db/src"),
    },
  },
});
