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
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT ?? "30000", 10),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export { sql } from "drizzle-orm";
export { uuidV7 } from "./uuid-v7";
export { runInTenantContext, type TenantUser } from "./tenant-context";
