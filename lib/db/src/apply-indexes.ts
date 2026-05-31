import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { Pool } = pg;

const rootDir = path.resolve(__dirname, "../../../");
const envPath = path.join(rootDir, ".env");

// Load .env manually if not set
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
      const [key, value] = trimmed.split("=", 2);
      process.env[key.trim()] = value.trim().replace(/^"|"$/g, "");
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const client = await pool.connect();
  try {
    console.log("Connected to database. Initializing drizzle schema and __drizzle_migrations table...");
    
    await client.query("CREATE SCHEMA IF NOT EXISTS drizzle;");
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      );
    `);

    // We only register migrations 0000 to 0009. The rest (0010 to 0018) should be run by Drizzle Kit physically.
    const baseMigrations = [
      { id: 0, tag: "0000_rare_silver_fox" },
      { id: 1, tag: "0001_free_moira_mactaggert" },
      { id: 2, tag: "0002_harsh_monster_badoon" },
      { id: 3, tag: "0003_legal_ares" },
      { id: 4, tag: "0004_sudden_spectrum" },
      { id: 5, tag: "0005_charming_psynapse" },
      { id: 6, tag: "0006_odd_machine_man" },
      { id: 7, tag: "0007_wide_zarda" },
      { id: 8, tag: "0008_acoustic_cassandra_nova" },
      { id: 9, tag: "0009_smooth_hellfire_club" }
    ];

    // Clear any mistakenly recorded migrations above 9
    console.log("Clearing migration records for ID >= 10 from __drizzle_migrations...");
    await client.query("DELETE FROM drizzle.__drizzle_migrations WHERE id >= 10;");

    const migrationsDir = path.resolve(__dirname, "../migrations");

    for (const migration of baseMigrations) {
      const sqlFilename = `${migration.tag}.sql`;
      const sqlPath = path.join(migrationsDir, sqlFilename);
      
      if (!fs.existsSync(sqlPath)) {
        console.error(`ERROR: Base migration file not found: ${sqlPath}`);
        continue;
      }

      const sqlContent = fs.readFileSync(sqlPath, "utf8");
      const hash = crypto.createHash("sha256").update(sqlContent).digest("hex");

      const checkRes = await client.query(
        "SELECT id FROM drizzle.__drizzle_migrations WHERE id = $1",
        [migration.id]
      );

      if (checkRes.rows.length === 0) {
        console.log(`Recording base migration ${migration.tag} (ID: ${migration.id}) in __drizzle_migrations...`);
        await client.query(
          "INSERT INTO drizzle.__drizzle_migrations (id, hash, created_at) VALUES ($1, $2, $3)",
          [migration.id, hash, Date.now()]
        );
      } else {
        console.log(`Base migration ${migration.tag} already recorded.`);
      }
    }

    console.log("Database migrations journal synchronized for base migrations 0000-0009.");
    
    // Now trigger Drizzle Kit to run the remaining migrations physically!
    console.log("Triggering Drizzle Kit to apply migrations 0010 through 0018 physically...");
    execSync("pnpm --filter @workspace/db run db:migrate", {
      env: process.env,
      stdio: "inherit"
    });

    console.log("SUCCESS: All pending migrations (0010-0018) successfully synchronized and physically applied!");
  } catch (err) {
    console.error("FATAL ERROR running synchronization:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
