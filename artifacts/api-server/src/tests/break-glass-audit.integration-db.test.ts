/**
 * Break-glass audit durability — REAL Postgres.
 *
 * Proves the core invariant: after a doctor reads PHI via break-glass,
 * a BREAK_GLASS_ACCESS row is present in audit_logs IMMEDIATELY — synchronous,
 * not deferred to the 5-second outbox drain. This proves `auditBreakGlass`
 * writes directly into audit_logs and not into audit_outbox.
 *
 * Also pins:
 *   - BREAK_GLASS_ACTIVATED is durable immediately after activation.
 *   - The row survives before any drain tick fires (no drain is started here).
 *
 * Test calls services directly with a minimal { user, headers, ip } request
 * (same pattern as imaging-attachments.integration-db.test.ts).
 * Gated to `pnpm test:integration-db`. Requires Docker or INTEGRATION_PG_ADMIN_URL.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";

let harness: RealDbHarness;
let seed: CrossTenantSeed;

let activateBreakGlass: any;
let getLabTest: any;
let auditLogsTable: any;
let labTestsTable: any;
let usersTable: any;
let doctorPatientsTable: any;

let doctor: { id: number };
let labTest: { id: number };

const JUSTIFICATION = "Patient unconscious, reviewing labs before emergency procedure — authorized break-glass access";

beforeAll(async () => {
  harness = await startRealDb();

  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);

  const db = (await import("@workspace/db")) as any;
  auditLogsTable = db.auditLogsTable;
  labTestsTable = db.labTestsTable;
  usersTable = db.usersTable;
  doctorPatientsTable = db.doctorPatientsTable;

  const { hashPassword } = await import("../lib/password");
  ({ activateBreakGlass } = await import("../services/break-glass.service"));
  ({ getLabTest } = await import("../services/lab.service"));
  await import("../app"); // wire runtime (SSE bus, metrics)

  const pw = await hashPassword("Bg@udit_T3st!");
  const [dr] = (await harness.db.insert(usersTable).values({
    username: "bg_audit_doctor", fullName: "BG Audit Doctor",
    passwordHash: pw, role: "doctor", clinicId: seed.clinicA.id,
  }).returning()) as any[];
  doctor = dr;

  // Intentionally NOT inserting a doctor_patients row — this doctor is NOT
  // assigned to patientA, so PHI access requires break-glass.

  // Create a lab test for patientA
  const [lab] = (await harness.db.insert(labTestsTable).values({
    clinicId: seed.clinicA.id,
    patientId: seed.patientA.id,
    requestedById: seed.superAdminA.id,
    testName: "CBC Panel",
    status: "requested",
  }).returning()) as any[];
  labTest = lab;
}, 120_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

function reqOf(user: object) {
  return { user, headers: {}, ip: "127.0.0.1", socket: {} } as any;
}

describe("Break-glass audit durability", () => {
  it("[INVARIANT] BREAK_GLASS_ACTIVATED is in audit_logs synchronously, before any drain tick", async () => {
    const req = reqOf({ userId: doctor.id, clinicId: seed.clinicA.id, role: "doctor" });
    await activateBreakGlass(req, seed.patientA.id, {
      justification: JUSTIFICATION,
      reasonCategory: "patient_unconscious",
    });

    // Query audit_logs directly — no drain tick has fired
    const rows = await harness.db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.action, "BREAK_GLASS_ACTIVATED"),
          eq(auditLogsTable.userId, doctor.id),
          eq(auditLogsTable.clinicId, seed.clinicA.id),
        ),
      );

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0] as any;
    expect(row.entityType).toBe("break_glass_session");
    expect(row.details).toMatchObject({ patientId: seed.patientA.id, reasonCategory: "patient_unconscious" });
  });

  it("[INVARIANT] BREAK_GLASS_ACCESS is in audit_logs synchronously after getLabTest", async () => {
    // After activation above the doctor holds an active session for patientA.
    const req = reqOf({ userId: doctor.id, clinicId: seed.clinicA.id, role: "doctor" });

    // getLabTest resolves break-glass, passes breakGlassPatientIds to runInTenantContext,
    // and calls auditBreakGlass — expect the row in audit_logs before returning.
    const test = await getLabTest(req, labTest.id);
    expect(test).toBeDefined();
    expect(test.id).toBe(labTest.id);

    // Query audit_logs immediately — no 5-second outbox drain required
    const rows = await harness.db
      .select()
      .from(auditLogsTable)
      .where(
        and(
          eq(auditLogsTable.action, "BREAK_GLASS_ACCESS"),
          eq(auditLogsTable.userId, doctor.id),
          eq(auditLogsTable.clinicId, seed.clinicA.id),
        ),
      );

    expect(rows.length).toBeGreaterThanOrEqual(1);
    const row = rows[0] as any;
    expect(row.entityType).toBe("lab_test");
    expect(String(row.entityId)).toBe(String(labTest.id));
  });
});
