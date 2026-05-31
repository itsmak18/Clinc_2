import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve the actual zod package from the pnpm store
const zodRoot = path.resolve(__dirname, "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod");

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks", // ESM-safe pool
    globals: true,
    setupFiles: ["./src/tests/setup.env.ts"],
    // Default suite excludes the real-Postgres integration tests — those run
    // under `pnpm test:integration-db` against vitest.config.integration.ts
    // and need a Docker daemon. Including them here would break the fast
    // mocked-DB suite on machines without Docker.
    exclude: ["**/node_modules/**", "**/*.integration-db.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**", "src/middlewares/**"],
      exclude: ["src/lib/logger.ts"],
      // scope.ts MUST reach 100% branch coverage
      thresholds: {
        "src/lib/scope.ts": { branches: 100, functions: 100 },
        "src/lib/password.ts": { branches: 100, functions: 100 },
        // middlewares/auth.ts is now a thin shim over `lib/policy.ts` —
        // coverage now lives on the kernel (tests/policy.unit.test.ts).
        "src/lib/policy.ts": { branches: 90, functions: 100 },
      },
    },
  },
  resolve: {
    alias: {
      // Workspace packages resolved to source for tests
      "@workspace/db": path.resolve(__dirname, "../../lib/db/src"),
      // zod/v4 subpath — resolve to the actual installed zod package
      "zod/v4": path.join(zodRoot, "v4"),
      "zod": zodRoot,
    },
  },
});
