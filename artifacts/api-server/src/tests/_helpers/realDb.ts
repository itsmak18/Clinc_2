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
  /** Present only in Testcontainers mode; undefined when using a local Postgres. */
  container?: StartedPostgreSqlContainer;
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

/**
 * Apply all migrations as the bootstrap superuser, create the medicore_app role
 * (NOSUPERUSER NOBYPASSRLS) with grants mirroring migration 0020, switch
 * DATABASE_URL to the medicore_app URI, and return the super/app clients.
 *
 * `superUri` must be a superuser connection to a freshly-created, empty database.
 * Shared by both the Testcontainers path and the local-Postgres path.
 */
async function provision(superUri: string): Promise<{
  dbSuper: NodePgDatabase<Record<string, never>>;
  superPool: pg.Pool;
  appPool: pg.Pool;
  appUri: string;
}> {
  const superPool = new pg.Pool({ connectionString: superUri, max: 5 });
  const dbSuper = drizzle(superPool);

  for (const file of discoverMigrations()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    await superPool.query(sql);
  }

  // medicore_app role + grants. Roles are cluster-wide, so on a shared local
  // Postgres the role may already exist — IF NOT EXISTS + ALTER handles both.
  // Grants are per-database, so they live and die with this DB. NOTE: the blanket
  // GRANT below re-grants UPDATE/DELETE on every table; migration 0026 revoked
  // them on audit_logs, so we re-apply 0026 after the grant to keep audit_logs
  // append-only (the prod migrate container runs 0026 last; here we mirror that).
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
    REVOKE UPDATE, DELETE ON audit_logs FROM ${APP_ROLE};
    DO $$
    DECLARE part text;
    BEGIN
      FOR part IN
        SELECT c.relname FROM pg_class c
        JOIN pg_inherits i ON c.oid = i.inhrelid
        JOIN pg_class p ON i.inhparent = p.oid
        WHERE p.relname = 'audit_logs'
      LOOP EXECUTE format('REVOKE UPDATE, DELETE ON %I FROM ${APP_ROLE}', part); END LOOP;
    END $$;
    -- payments is append-only too (migration 0040, mirrors audit_logs). The blanket
    -- GRANT above re-granted UPDATE/DELETE; re-apply the revoke so the ledger stays
    -- immutable in tests, exactly as the prod migrate container's 0040 leaves it.
    REVOKE UPDATE, DELETE ON payments FROM ${APP_ROLE};
  `);

  const u = new URL(superUri);
  const appUri = `postgresql://${APP_ROLE}:${APP_ROLE_PASSWORD}@${u.hostname}:${u.port}${u.pathname}`;

  // Switch DATABASE_URL so @workspace/db (imported dynamically by the test after
  // startRealDb() returns) connects as medicore_app — exactly like production.
  process.env.DATABASE_URL = appUri;

  const appPool = new pg.Pool({ connectionString: appUri, max: 5 });
  return { dbSuper, superPool, appPool, appUri };
}

/**
 * Start a real Postgres for an integration test.
 *
 * Default: a throwaway `postgres:16-alpine` Testcontainer (CI path, unchanged).
 *
 * No-Docker fallback: set `INTEGRATION_PG_ADMIN_URL` to a SUPERUSER connection
 * string on a local Postgres (pointing at any existing maintenance DB, e.g.
 * `postgresql://postgres:pw@localhost:5432/postgres`). The harness creates a
 * uniquely-named scratch database on that server, provisions it identically, and
 * DROPs it on stop(). Lets the integration-db suite run without Docker.
 */
export async function startRealDb(): Promise<RealDbHarness> {
  const adminUrl = process.env.INTEGRATION_PG_ADMIN_URL;

  if (adminUrl) {
    // ── Local Postgres path (no Docker) ──────────────────────────────────────
    const scratchName = `medicore_it_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const superUri = (() => {
      const u = new URL(adminUrl);
      u.pathname = `/${scratchName}`;
      return u.toString();
    })();

    // Parallel forks share ONE local cluster, so CREATE DATABASE (pg_database)
    // and migration 0020's CREATE/ALTER ROLE + ALTER DEFAULT PRIVILEGES
    // (pg_authid / pg_default_acl) race with "tuple concurrently updated".
    // Serialize the whole cluster-global setup with a session advisory lock held
    // on a dedicated admin connection; release it before the tests run so they
    // still execute in parallel. (Testcontainers uses separate clusters, so this
    // path doesn't run there.)
    const PROVISION_LOCK_KEY = 0x6d65_6469; // "medi"
    const lockClient = new pg.Client({ connectionString: adminUrl });
    await lockClient.connect();
    await lockClient.query("SELECT pg_advisory_lock($1)", [PROVISION_LOCK_KEY]);

    let provisioned: { dbSuper: NodePgDatabase<Record<string, never>>; superPool: pg.Pool; appPool: pg.Pool; appUri: string };
    try {
      await lockClient.query(`CREATE DATABASE ${scratchName}`);
      provisioned = await provision(superUri);
    } finally {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [PROVISION_LOCK_KEY]).catch(() => {});
      await lockClient.end().catch(() => {});
    }
    const { dbSuper, superPool, appPool, appUri } = provisioned;

    return {
      db: dbSuper,
      pool: appPool,
      connectionUri: appUri,
      async stop() {
        await appPool.end().catch(() => {});
        await superPool.end().catch(() => {});
        // Close the @workspace/db singleton pool the test opened against this
        // scratch DB, so the FORCE drop below has no live connections to
        // terminate (which would surface as an unhandled rejection / exit 1).
        try {
          const m = (await import("@workspace/db")) as { pool?: { end?: () => Promise<void> } };
          await m.pool?.end?.();
        } catch {
          /* not imported in this file, or already closed */
        }
        const drop = new pg.Pool({ connectionString: adminUrl, max: 1 });
        try {
          await drop.query(`DROP DATABASE IF EXISTS ${scratchName} WITH (FORCE)`);
        } finally {
          await drop.end();
        }
      },
    };
  }

  // ── Testcontainers path (default — CI) ─────────────────────────────────────
  const container = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("medicore_test")
    .withUsername("test")
    .withPassword("test")
    .start();

  const { dbSuper, superPool, appPool, appUri } = await provision(container.getConnectionUri());

  return {
    db: dbSuper,
    pool: appPool,
    container,
    connectionUri: appUri,
    async stop() {
      await appPool.end().catch(() => {});
      await superPool.end().catch(() => {});
      try {
        const m = (await import("@workspace/db")) as { pool?: { end?: () => Promise<void> } };
        await m.pool?.end?.();
      } catch {
        /* not imported in this file, or already closed */
      }
      await container.stop();
    },
  };
}
