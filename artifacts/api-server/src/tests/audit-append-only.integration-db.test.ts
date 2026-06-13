/**
 * audit_logs append-only across partitions — REAL Postgres.
 *
 * Migration 0026 made audit_logs append-only for medicore_app (no UPDATE/DELETE).
 * Migration 0020's ALTER DEFAULT PRIVILEGES, however, re-grants UPDATE/DELETE on
 * any table created later by the owner — so a NEW partition would silently become
 * writable/deletable, re-opening the audit-tampering hole. Migration 0028 installs
 * a `ddl_command_end` event trigger that auto-REVOKEs UPDATE/DELETE on any new
 * audit_logs partition.
 *
 * This test proves the guard end-to-end on real PG16: create a future partition as
 * the owner and assert medicore_app cannot UPDATE/DELETE it (but can still
 * SELECT/INSERT), and that EVERY existing partition is append-only too.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker (or INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import { sql } from "drizzle-orm";

let harness: RealDbHarness;

beforeAll(async () => {
  // startRealDb() applies every migration including 0028 (the event trigger), then
  // provisions medicore_app. So the trigger is live before this test creates a partition.
  harness = await startRealDb();
}, 120_000);

afterAll(async () => {
  await harness?.stop();
});

async function hasPriv(role: string, table: string, priv: string): Promise<boolean> {
  const res: any = await harness.db.execute(
    sql`SELECT has_table_privilege(${role}, ${table}, ${priv}) AS ok`,
  );
  const rows = res.rows ?? res;
  return rows[0].ok === true;
}

describe("audit_logs append-only — partition guard (event trigger, migration 0028)", () => {
  it("a NEW audit_logs partition is auto-revoked UPDATE/DELETE for medicore_app", async () => {
    await harness.db.execute(sql`
      CREATE TABLE audit_logs_2037_01 PARTITION OF audit_logs
      FOR VALUES FROM ('2037-01-01') TO ('2037-02-01')
    `);

    // The event trigger fired on creation → no write/delete for the runtime role…
    expect(await hasPriv("medicore_app", "audit_logs_2037_01", "UPDATE")).toBe(false);
    expect(await hasPriv("medicore_app", "audit_logs_2037_01", "DELETE")).toBe(false);
    // …but reads + appends still work (the guard didn't over-revoke).
    expect(await hasPriv("medicore_app", "audit_logs_2037_01", "SELECT")).toBe(true);
    expect(await hasPriv("medicore_app", "audit_logs_2037_01", "INSERT")).toBe(true);
  });

  it("EVERY existing audit_logs partition is append-only for medicore_app", async () => {
    const res: any = await harness.db.execute(sql`
      SELECT c.relname AS part
      FROM pg_class c
      JOIN pg_inherits i ON c.oid = i.inhrelid
      JOIN pg_class p ON i.inhparent = p.oid
      WHERE p.relname = 'audit_logs'
    `);
    const parts: string[] = (res.rows ?? res).map((r: any) => r.part);
    expect(parts.length).toBeGreaterThan(0);

    for (const part of parts) {
      expect(await hasPriv("medicore_app", part, "UPDATE"), `${part} must not be UPDATE-able`).toBe(false);
      expect(await hasPriv("medicore_app", part, "DELETE"), `${part} must not be DELETE-able`).toBe(false);
    }
  });
});
