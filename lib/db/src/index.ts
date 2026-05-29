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
  max:             parseInt(process.env.DB_POOL_MAX          ?? "10", 10),
  idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT ?? "30000", 10),
  connectionTimeoutMillis: parseInt(process.env.DB_POOL_CONNECT_TIMEOUT ?? "5000", 10),
});
export const db = drizzle(pool, { schema });

export * from "./schema";
export { sql } from "drizzle-orm";
export { uuidV7 } from "./uuid-v7";
