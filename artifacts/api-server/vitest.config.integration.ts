/**
 * Vitest config for the real-Postgres integration suite (testcontainers).
 *
 * Runs ONLY `*.integration-db.test.ts` files. Each test spins up a fresh
 * postgres:16-alpine container in `beforeAll` and tears it down in `afterAll`.
 * Container startup + migration apply ≈ 10s — sequential execution is faster
 * than parallel here because Docker socket contention dominates.
 *
 * Gated to `pnpm test:integration-db`. The default `pnpm test` config
 * (vitest.config.ts) excludes these files via a different `include`.
 */
import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zodRoot = path.resolve(__dirname, "../../node_modules/.pnpm/zod@3.25.76/node_modules/zod");

export default defineConfig({
  test: {
    environment: "node",
    pool: "forks",
    // Each test file MUST run in its OWN process. `@workspace/db` creates its pg
    // Pool eagerly at module load from process.env.DATABASE_URL (lib/db/src/index.ts),
    // and each file provisions its own per-file database in beforeAll. A shared
    // process (singleFork, or a reused sequential fork) pins that singleton pool to
    // the FIRST file's DB → later files hit "database does not exist" / "Cannot use a
    // pool after end" once that file tears down. Parallel forks give one process per
    // file = one fresh pool per DB. `maxForks: 2` caps concurrent DB/container setup.
    poolOptions: { forks: { singleFork: false } },
    maxWorkers: 2,
    minWorkers: 1,
    globals: true,
    setupFiles: ["./src/tests/setup.env.ts"],
    include: ["src/tests/**/*.integration-db.test.ts"],
    testTimeout: 60_000, // container start can take 10–30s on cold pull
    hookTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@workspace/db": path.resolve(__dirname, "../../lib/db/src"),
      "zod/v4": path.join(zodRoot, "v4"),
      "zod": zodRoot,
    },
  },
});
