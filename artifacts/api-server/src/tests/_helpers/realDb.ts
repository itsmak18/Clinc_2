/**
 * Real-Postgres test harness.
 *
 * Spins up a fresh postgres:16-alpine container per call, applies every
 * migration in lib/db/migrations in numeric order, and returns a Drizzle
 * client + tear-down.
 *
 * Migration application: we DON'T use drizzle-orm's migrator here because the
 * project's `_journal.json` only tracks 0000-0009. Migrations 0010-0013 are
 * hand-authored and not in the journal (pre-existing tech debt). To apply the
 * full schema in tests, we read every `NNNN_*.sql` file directly and execute
 * them in lexical order. This matches what `drizzle-kit migrate` would do for
 * journal entries plus what production must do via psql for the hand-authored
 * tail.
 *
 * Requires a running Docker daemon. These tests live in `*.integration-db.test.ts`
 * files and are gated to the `test:integration-db` script (CI job `integration-db`).
 *
 * Why a real DB and not a mock: the most important invariant in MediCore is that
 * a clinic A user cannot read clinic B's PHI. That guarantee is currently
 * enforced only by hand-written `eq(table.clinicId, …)` filters and is mock-
 * tested only. A regression that drops a clinic filter would pass the existing
 * 460-test mocked suite. A regression caught against a real Postgres will not.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// artifacts/api-server/src/tests/_helpers → repo-root/lib/db/migrations
const MIGRATIONS_DIR = path.resolve(__dirname, "../../../../../lib/db/migrations");

export interface RealDbHarness {
  db: NodePgDatabase<Record<string, never>>;
  pool: pg.Pool;
  container: StartedPostgreSqlContainer;
  connectionUri: string;
  stop: () => Promise<void>;
}

/** All migration .sql files in numeric/lexical order, excluding the un-numbered
 *  `remove_in_progress_enum.sql` (which is a one-off cleanup, not a schema
 *  migration). */
function discoverMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
}

export async function startRealDb(): Promise<RealDbHarness> {
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("medicore_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const connectionUri = container.getConnectionUri();
  process.env.DATABASE_URL = connectionUri;

  const pool = new pg.Pool({ connectionString: connectionUri, max: 5 });
  const db = drizzle(pool);

  for (const file of discoverMigrations()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    // Drizzle emits `--> statement-breakpoint` comments between statements;
    // node-postgres handles multi-statement strings as a single query batch,
    // so we don't need to split — the comment is harmless.
    await pool.query(sql);
  }

  return {
    db,
    pool,
    container,
    connectionUri,
    async stop() {
      await pool.end();
      await container.stop();
    },
  };
}
