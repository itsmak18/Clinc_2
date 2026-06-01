import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Pool sizing — tune via env vars per environment
  max:             parseInt(process.env.DB_POOL_MAX          ?? "40", 10),
  min:             parseInt(process.env.DB_POOL_MIN          ?? "2", 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT ?? "30000", 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECT_TIMEOUT ?? "5000", 10),
  allowExitOnIdle: true,
  // statement_timeout is NOT set here. Under PgBouncer transaction pooling a
  // session-level SET leaks to the next connection borrower after DISCARD ALL
  // resets it unpredictably. Instead, it is enforced via ALTER ROLE medicore_app
  // SET statement_timeout = '30000ms' (migration 0021) which is a per-backend
  // role default that RESET ALL restores correctly — pooling-safe.
});
export const db = drizzle(pool, { schema });

// dbUnsafe is an alias of db for service paths that legitimately bypass tenant
// context: pre-auth (login/reset/device), audit trail reads, and tables with no
// clinicId (doctor_schedules, schedule_overrides, csp_reports, etc.).
// Each import site MUST carry a one-line justification comment explaining why
// the raw client is appropriate. The eslint rule in api-server blocks `db`
// imports in services/** — use this named export instead.
export const dbUnsafe = db;

export * from "./schema";
export { sql } from "drizzle-orm";
export { uuidV7 } from "./uuid-v7";
export { runInTenantContext, type TenantUser } from "./tenant-context";
