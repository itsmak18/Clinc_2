/**
 * AUD-SEAM-07 (discovered 2026-07-02, while verifying the AUD-SEAM-05 fix) —
 * system-actor audit events must survive the drain into audit_logs, proven
 * against real Postgres.
 *
 * audit_logs.user_id FKs to users.id (per-partition constraint
 * audit_logs_part_user_id_fkey). buildAuditRow stamps userId = SYSTEM_USER_ID
 * (-1) for any audit event emitted without an authenticated request context —
 * concretely, the hourly SYSTEM_NO_SHOW cron (cron.ts) and any other
 * system-context logAudit call. audit_outbox has no such FK, so the write
 * there always succeeds; but before this fix, the drain copied -1 into
 * audit_logs verbatim, where no users row has that id. The insert failed the
 * FK, retried up to MAX_ATTEMPTS, exhausted, and the event was permanently
 * lost — the exact "control passes audits without working" shape, and a
 * HIPAA §164.312(b) gap that would have fired hourly in production.
 *
 * This test seeds a real system-actor outbox row (userId: SYSTEM_USER_ID) and
 * drains it. Pre-fix this fails at the second assertion (FK violation, row
 * never reaches audit_logs, stuck retrying in audit_outbox). Post-fix it
 * passes: the row lands in audit_logs with user_id NULL (the column's
 * intended "no user / system actor" meaning) and is removed from
 * audit_outbox on the first attempt — no retry, no loss.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker OR a local Postgres via
 * INTEGRATION_PG_ADMIN_URL (see _helpers/realDb.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import { SYSTEM_USER_ID, SYSTEM_CLINIC_ID } from "../lib/audit";

let harness: RealDbHarness;
let db: typeof import("@workspace/db").db;
let drainAuditOutbox: typeof import("../lib/audit").drainAuditOutbox;
let auditOutboxTable: any;
let auditLogsTable: any;

beforeAll(async () => {
  harness = await startRealDb();
  ({ db, auditOutboxTable, auditLogsTable } = await import("@workspace/db"));
  ({ drainAuditOutbox } = await import("../lib/audit"));
}, 180_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

describe("AUD-SEAM-07 — system-actor (SYSTEM_USER_ID) events survive the drain", () => {
  it("a system-actor outbox row is drained into audit_logs with user_id NULL, not lost to an FK retry loop", async () => {
    await db.insert(auditOutboxTable).values({
      clinicId: SYSTEM_CLINIC_ID,
      userId: SYSTEM_USER_ID, // exactly what buildAuditRow stamps when req.user is absent
      action: "SYSTEM_NO_SHOW",
      entityType: "appointment",
      entityId: "seam07-1",
      ipAddress: "unknown",
      userAgent: null,
      details: { count: 1 },
      beforeState: null,
      afterState: null,
      requestId: null,
    });

    await drainAuditOutbox();

    // The row must be gone from the outbox — drained on the first attempt,
    // not stuck retrying because of an FK violation.
    const outboxRows = await db.select().from(auditOutboxTable).where(sql`entity_id = 'seam07-1'`);
    expect(
      outboxRows.length,
      "row still in audit_outbox — the drain failed (the exact permanent-loss bug this test guards against) instead of succeeding",
    ).toBe(0);

    // It must have landed in audit_logs — not been silently discarded — with
    // user_id NULL (the column's nullable "system actor" meaning), not -1.
    const logRows = await db.select().from(auditLogsTable).where(sql`entity_id = 'seam07-1'`);
    expect(logRows.length).toBe(1);
    expect((logRows[0] as { userId: number | null }).userId).toBeNull();
    expect((logRows[0] as { action: string }).action).toBe("SYSTEM_NO_SHOW");
  });

  it("[regression guard] the outbox write path itself is untouched — SYSTEM_USER_ID still stored as -1 pre-drain", async () => {
    // This proves the fix is scoped to the audit_logs crossing only; the
    // outbox (no FK) still legitimately stores the raw sentinel, matching
    // audit.failure.test.ts's existing unit-level assertion.
    await db.insert(auditOutboxTable).values({
      clinicId: SYSTEM_CLINIC_ID,
      userId: SYSTEM_USER_ID,
      action: "SYSTEM_NO_SHOW",
      entityType: "appointment",
      entityId: "seam07-2",
      ipAddress: "unknown",
      userAgent: null,
      details: null,
      beforeState: null,
      afterState: null,
      requestId: null,
    });

    const preDrainRows = await db.select().from(auditOutboxTable).where(sql`entity_id = 'seam07-2'`);
    expect((preDrainRows[0] as { userId: number }).userId).toBe(SYSTEM_USER_ID);

    await drainAuditOutbox(); // cleanup — drain it so it doesn't linger for other test files sharing this scratch DB
  });
});
