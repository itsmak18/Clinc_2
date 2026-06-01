/**
 * Real-Postgres test harness.
 *
 * Spins up a fresh postgres:16-alpine container per call, applies every
 * migration in lib/db/migrations in numeric order, and returns a Drizzle
 * client + tear-down.
 *
 * Migration application: we DON'T use drizzle-orm's migrator here because it
 * uses _journal.json which tracks 0000-0019 (and now 0020). Instead we read
 * every `NNNN_*.sql` file directly and execute them in lexical order. This
 * matches what `drizzle-kit migrate` would do in production and is simpler
 * than parsing the journal format.
 *
 * medicore_app role (F-01 fix, 2026-06-02):
 *   After running migrations as the bootstrap superuser, this harness creates
 *   the medicore_app role (NOSUPERUSER NOBYPASSRLS) and grants it the same
 *   permissions as migration 0020. It then switches DATABASE_URL to a URI
 *   connecting as medicore_app before the RLS integration tests import
 *   @workspace/db. This means `runInTenantContext`'s internal `db` pool
 *   connects as medicore_app — exactly like production — making the RLS
 *   tenant isolation tests meaningful.
 *
 *   The returned `harness.pool` is the medicore_app pool (non-superuser).
 *   This is what STEP-0 PROBE queries to verify rolsuper=false.
 *   The internal superuser pool is only used for setup and is closed on stop().
 *
 * Requires a running Docker daemon. These tests live in `*.integration-db.test.ts`
 * files and are gated to the `test:integration-db` script (CI job `integration-db`).
 *
 * Why a real DB and not a mock: the most important invariant in MediCore is that
 * a clinic A user cannot read clinic B's PHI. That guarantee is enforced by RLS
 * (migration 0015 + medicore_app non-superuser role). A regression that connects
 * the app as a superuser would silently disable all RLS enforcement. A regression
 * caught by this harness will fail the explicit rolsuper guard.
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

const APP_ROLE = "medicore_app";
const APP_ROLE_PASSWORD = "medicore_app_test_pw_ci";

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

  const superUri = container.getConnectionUri();

  // Superuser pool — used only for migrations + role setup.
  const superPool = new pg.Pool({ connectionString: superUri, max: 5 });
  const dbSuper = drizzle(superPool);

  // Apply all migrations as the bootstrap superuser (DDL rights required).
  for (const file of discoverMigrations()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await superPool.query(sql);
  }

  // Create medicore_app role (NOSUPERUSER NOBYPASSRLS) and grant it DML on
  // all tables — mirrors migration 0020 and the compose medicore_app setup.
  // The role must exist before the RLS tests run.
  await superPool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
      END IF;
    END $$;
    ALTER ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_ROLE_PASSWORD}';
    GRANT USAGE ON SCHEMA public TO ${APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE};
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
      GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE};
  `);

  // Build the app URI (medicore_app role, non-superuser).
  const containerUrl = new URL(superUri);
  const host = containerUrl.hostname;
  const port = containerUrl.port;
  const dbName = containerUrl.pathname.slice(1);
  const appUri = `postgresql://${APP_ROLE}:${APP_ROLE_PASSWORD}@${host}:${port}/${dbName}`;

  // Switch DATABASE_URL to the app role URI so that @workspace/db (imported
  // dynamically by the test after startRealDb() returns) connects as
  // medicore_app — exactly like production. This makes runInTenantContext's
  // internal db pool subject to RLS enforcement.
  process.env.DATABASE_URL = appUri;

  // App pool (non-superuser) — returned as harness.pool so STEP-0 PROBE
  // queries current_user / rolsuper / rolbypassrls via the same role the
  // app actually uses.
  const appPool = new pg.Pool({ connectionString: appUri, max: 5 });

  return {
    db: dbSuper,
    pool: appPool,
    container,
    connectionUri: appUri,
    async stop() {
      await appPool.end();
      await superPool.end();
      await container.stop();
    },
  };
}
