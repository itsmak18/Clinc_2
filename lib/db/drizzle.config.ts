/// <reference types="node" />
import { defineConfig } from "drizzle-kit";

// DATABASE_URL is required for push/migrate but not for generate (schema snapshot only).
// The drizzle-kit CLI will emit its own error if dbCredentials are missing when needed.
const databaseUrl = process.env.DATABASE_URL ?? "";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./migrations",         // migration files committed to git
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,               // log every SQL statement
  strict: true,                // prompt before destructive operations
});
