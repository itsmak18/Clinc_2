/**
 * V-01 — Data Retention Report tenant isolation (REAL Postgres).
 *
 * `computeRetentionByClinic()` must return each clinic's OWN figures only. The
 * bug it fixes computed three GLOBAL `COUNT(*)` queries and fanned the
 * system-wide totals to every clinic's compliance officers — a cross-tenant leak
 * of other tenants' compliance volume the instant a second clinic onboards.
 *
 * This seeds two clinics with deliberately ASYMMETRIC counts (A has overdue
 * audits but no erasure; B has erasure but no overdue audits) so a regression to
 * the global-sum bug is impossible to miss: under the bug both clinics would
 * report the same system-wide totals.
 *
 * Gated to `pnpm test:integration-db` (real Postgres via Testcontainers or a
 * local INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";
import type { ClinicRetentionCounts } from "../cron";

let harness: RealDbHarness;
let seed: CrossTenantSeed;
let computeRetentionByClinic: () => Promise<Map<number, ClinicRetentionCounts>>;
// Lazily bound in beforeAll — @workspace/db throws at module load if DATABASE_URL
// is unset (which it is at collection time), so it must be imported dynamically
// AFTER startRealDb() sets it.
let db: any;
let auditLogsTable: any;
let erasureRequestsTable: any;
let patientsTable: any;

beforeAll(async () => {
  harness = await startRealDb();

  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);

  const dbmod = await import("@workspace/db");
  db = dbmod.db;
  ({ auditLogsTable, erasureRequestsTable, patientsTable } = dbmod);
  ({ computeRetentionByClinic } = await import("../cron"));

  const eightYearsAgo = new Date();
  eightYearsAgo.setFullYear(eightYearsAgo.getFullYear() - 8);
  const now = new Date();
  const fortyDaysAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);

  // Clinic A: 3 overdue audit logs (>7y) that MUST count + 1 recent that MUST NOT.
  await db.insert(auditLogsTable).values([
    { clinicId: seed.clinicA.id, action: "RETENTION_TEST", entityType: "t", ipAddress: "127.0.0.1", createdAt: eightYearsAgo },
    { clinicId: seed.clinicA.id, action: "RETENTION_TEST", entityType: "t", ipAddress: "127.0.0.1", createdAt: eightYearsAgo },
    { clinicId: seed.clinicA.id, action: "RETENTION_TEST", entityType: "t", ipAddress: "127.0.0.1", createdAt: eightYearsAgo },
    { clinicId: seed.clinicA.id, action: "RETENTION_TEST", entityType: "t", ipAddress: "127.0.0.1", createdAt: now },
  ]);
  // Clinic B: only a recent audit log → 0 overdue.
  await db.insert(auditLogsTable).values([
    { clinicId: seed.clinicB.id, action: "RETENTION_TEST", entityType: "t", ipAddress: "127.0.0.1", createdAt: now },
  ]);

  // Clinic B: 2 pending erasure requests that MUST count + 1 executed that MUST
  // NOT (status filter). Clinic A: none.
  await db.insert(erasureRequestsTable).values([
    { clinicId: seed.clinicB.id, patientId: seed.patientB.id, requestedByUserId: seed.doctorB.id, reason: "test", status: "pending" },
    { clinicId: seed.clinicB.id, patientId: seed.patientB.id, requestedByUserId: seed.doctorB.id, reason: "test", status: "pending" },
    { clinicId: seed.clinicB.id, patientId: seed.patientB.id, requestedByUserId: seed.doctorB.id, reason: "test", status: "executed" },
  ]);

  // Clinic A: soft-delete Patient A 40 days ago (> 30d) → softDeleted = 1 for A, 0 for B.
  await db.update(patientsTable).set({ deletedAt: fortyDaysAgo }).where(eq(patientsTable.id, seed.patientA.id));
}, 120_000);

afterAll(async () => {
  await harness?.stop();
});

describe("V-01 · computeRetentionByClinic tenant isolation", () => {
  it("reports each clinic's OWN overdue-audit count, not the global total", async () => {
    const map = await computeRetentionByClinic();
    expect(map.get(seed.clinicA.id)?.overdueAuditLogs).toBe(3);
    expect(map.get(seed.clinicB.id)?.overdueAuditLogs ?? 0).toBe(0);
  });

  it("reports each clinic's OWN pending-erasure count (executed excluded), not the global total", async () => {
    const map = await computeRetentionByClinic();
    expect(map.get(seed.clinicB.id)?.openErasureRequests).toBe(2);
    expect(map.get(seed.clinicA.id)?.openErasureRequests ?? 0).toBe(0);
  });

  it("no clinic's figures are contaminated by another clinic's rows", async () => {
    const map = await computeRetentionByClinic();
    const a = map.get(seed.clinicA.id);
    const b = map.get(seed.clinicB.id);
    // Asymmetric by construction. Under the old global-sum bug, A and B would
    // report identical system-wide totals (overdue=3 AND erasure=2 for BOTH).
    expect(a?.overdueAuditLogs).toBe(3);
    expect(a?.openErasureRequests ?? 0).toBe(0);
    expect(a?.softDeletedPatientsOverThirtyDays).toBe(1);
    expect(b?.overdueAuditLogs ?? 0).toBe(0);
    expect(b?.openErasureRequests).toBe(2);
    expect(b?.softDeletedPatientsOverThirtyDays ?? 0).toBe(0);
  });
});
