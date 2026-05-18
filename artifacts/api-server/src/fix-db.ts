import { db } from "../../../lib/db/src/index";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`DROP TABLE IF EXISTS mfa_sessions CASCADE`);
  console.log('Dropped mfa_sessions table');
  
  await db.execute(sql`ALTER TABLE users DROP COLUMN IF EXISTS mfa_secret`);
  await db.execute(sql`ALTER TABLE users DROP COLUMN IF EXISTS mfa_enrolled_at`);
  await db.execute(sql`ALTER TABLE users DROP COLUMN IF EXISTS mfa_recovery_codes_hash`);
  console.log('Dropped MFA columns from users table');

  process.exit(0);
}

main().catch(console.error);
