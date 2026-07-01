/**
 * AUD-SEAM-05 (engineering audit, 2026-07-02) — audit-outbox drain atomicity,
 * proven against real Postgres.
 *
 * Before this fix, drainAuditOutbox's batch insert (into audit_logs) and
 * delete (from audit_outbox) were two independent statements. If the process
 * crashed — or, as forced here, the delete failed for any reason — after the
 * insert committed but before the delete ran, the row stayed in audit_outbox.
 * The next drain tick would re-insert the SAME event into audit_logs,
 * producing a duplicate that corrupts the daily hash-chain's row count.
 *
 * This test forces exactly that failure mode without touching any source
 * file under test: it REVOKEs DELETE on audit_outbox from the connecting
 * role, so drainAuditOutbox's delete half fails while its insert half would,
 * on its own, have succeeded. If the fix works, db.transaction() rolls back
 * the insert too — audit_logs gets ZERO new rows and audit_outbox keeps the
 * original row untouched (ready to retry once DELETE is restored). Without
 * the fix, this same scenario would leave a committed audit_logs row AND an
 * un-deleted audit_outbox row — a live duplicate waiting to happen on the
 * next tick.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker OR a local Postgres via
 * INTEGRATION_PG_ADMIN_URL (see _helpers/realDb.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";

let harness: RealDbHarness;
let db: typeof import("@workspace/db").db;
let drainAuditOutbox: typeof import("../lib/audit").drainAuditOutbox;
let auditOutboxTable: any;
let auditLogsTable: any;
let clinicsTable: any;

let clinicId: number;

beforeAll(async () => {
  harness = await startRealDb();
  ({ db, auditOutboxTable, auditLogsTable, clinicsTable } = await import("@workspace/db"));
  ({ drainAuditOutbox } = await import("../lib/audit"));

  const existing = (await db.select({ id: clinicsTable.id }).from(clinicsTable)) as Array<{ id: number }>;
  if (existing.find((r) => r.id === 1)) {
    clinicId = 1;
  } else {
    const inserted = (await db.insert(clinicsTable).values({ name: "Drain Atomicity Clinic" }).returning()) as Array<{ id: number }>;
    clinicId = inserted[0].id;
  }
}, 180_000);

afterAll(async () => {
  // Always restore DELETE before the harness tears down, even if a test
  // failed mid-way, so teardown's own cleanup queries aren't blocked.
  try {
    await harness.db.execute(sql`GRANT DELETE ON audit_outbox TO medicore_app`);
  } catch { /* role/table may already be gone if teardown raced */ }
  if (harness) await harness.stop();
});

describe("AUD-SEAM-05 — drain atomicity under a forced delete failure", () => {
  it("[sanity] a normal drain moves the row to audit_logs and removes it from audit_outbox", async () => {
    await db.insert(auditOutboxTable).values({
      clinicId, userId: null, action: "UPDATE", entityType: "invoice", entityId: "sanity-1",
      ipAddress: "127.0.0.1", userAgent: null, details: null, beforeState: null, afterState: null, requestId: null,
    });

    await drainAuditOutbox();

    const outboxRows = await db.select().from(auditOutboxTable).where(sql`entity_id = 'sanity-1'`);
    expect(outboxRows.length).toBe(0);

    const logRows = await db.select().from(auditLogsTable).where(sql`entity_id = 'sanity-1'`);
    expect(logRows.length).toBe(1);
  });

  it("a forced delete failure rolls back the insert too — no duplicate, row stays in outbox", async () => {
    await db.insert(auditOutboxTable).values({
      clinicId, userId: null, action: "UPDATE", entityType: "invoice", entityId: "atomicity-1",
      ipAddress: "127.0.0.1", userAgent: null, details: null, beforeState: null, afterState: null, requestId: null,
    });

    // Force the delete half of the transaction to fail. The insert half
    // would succeed on its own — this is exactly the crash-between-the-two-
    // statements scenario the fix must survive.
    await harness.db.execute(sql`REVOKE DELETE ON audit_outbox FROM medicore_app`);
    try {
      await drainAuditOutbox(); // batch attempt fails -> per-row fallback also fails (same revoke) -> attempts incremented, never throws
    } finally {
      await harness.db.execute(sql`GRANT DELETE ON audit_outbox TO medicore_app`);
    }

    // The insert must NOT have stuck — db.transaction rolled it back when the
    // subsequent delete failed. Zero rows in audit_logs proves atomicity.
    const logRows = await db.select().from(auditLogsTable).where(sql`entity_id = 'atomicity-1'`);
    expect(
      logRows.length,
      "audit_logs contains a row whose matching audit_outbox row was never deleted — this is the exact duplicate-on-retry bug SEAM-05 fixes",
    ).toBe(0);

    // The original row must still be in audit_outbox, untouched aside from
    // the per-row fallback's attempt-counter bump (which runs OUTSIDE the
    // failed inner transaction, in the outer catch).
    const outboxRows = await db.select().from(auditOutboxTable).where(sql`entity_id = 'atomicity-1'`);
    expect(outboxRows.length).toBe(1);
    expect((outboxRows[0] as { attempts: number }).attempts).toBeGreaterThan(0);

    // The per-row fallback's exponential backoff just set next_attempt_at
    // ~5s in the future, so an immediate drain tick wouldn't even select the
    // row. Reset it directly instead of sleeping the test suite for 5s —
    // this test is proving atomicity, not the backoff schedule (which is
    // pre-existing, unchanged behavior).
    await db.update(auditOutboxTable)
      .set({ nextAttemptAt: null })
      .where(sql`entity_id = 'atomicity-1'`);

    // Now that DELETE is restored, a normal drain must succeed exactly once —
    // proving no duplicate was silently created during the forced-failure window.
    await drainAuditOutbox();
    const logRowsAfterRetry = await db.select().from(auditLogsTable).where(sql`entity_id = 'atomicity-1'`);
    expect(logRowsAfterRetry.length).toBe(1);
    const outboxRowsAfterRetry = await db.select().from(auditOutboxTable).where(sql`entity_id = 'atomicity-1'`);
    expect(outboxRowsAfterRetry.length).toBe(0);
  });
});
