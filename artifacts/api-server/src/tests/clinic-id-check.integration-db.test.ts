/**
 * clinic_id CHECK constraint — REAL Postgres.
 *
 * Migration 0014 adds `CHECK (clinic_id > 0)` to every clinic-bearing table.
 * This test inserts rows directly via the Drizzle client (bypassing services)
 * and asserts that any non-positive clinic_id is rejected by the DB itself.
 *
 * Why this matters: even if the app-layer fail-closed kernel (policy.ts) is
 * bypassed via a future bug, the DB will refuse the row at write time.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";

let harness: RealDbHarness;
// Dynamically imported after migrations run.
let patientsTable: any;
let auditOutboxTable: any;
let invoicesTable: any;
let clinicsTable: any;
let usersTable: any;

beforeAll(async () => {
  // startRealDb() applies every migration in lib/db/migrations in lexical
  // order — including hand-authored 0010-0013 + the new 0014 — so by the time
  // this resolves the CHECK constraints are in place.
  harness = await startRealDb();
  ({ patientsTable, auditOutboxTable, invoicesTable, clinicsTable, usersTable } = await import("@workspace/db"));
}, 180_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

describe("clinic_id CHECK constraint (real Postgres)", () => {
  it("rejects INSERT into patients with clinic_id = 0", async () => {
    await expect(
      (harness.db as any).insert(patientsTable).values({
        clinicId: 0, mrn: "MRN-CHK-0", fullName: "Check 0", dateOfBirth: "1990-01-01",
        gender: "male", phone: "+1-555-9000",
      }),
    ).rejects.toThrow(/patients_clinic_id_positive|check constraint/i);
  });

  it("rejects INSERT into patients with clinic_id = -1", async () => {
    await expect(
      (harness.db as any).insert(patientsTable).values({
        clinicId: -1, mrn: "MRN-CHK-NEG", fullName: "Check Neg", dateOfBirth: "1990-01-01",
        gender: "male", phone: "+1-555-9001",
      }),
    ).rejects.toThrow(/patients_clinic_id_positive|check constraint/i);
  });

  it("accepts INSERT into patients with clinic_id = 1 (positive)", async () => {
    // clinic id 1 is seeded by migration 0000.
    const [row] = await (harness.db as any).insert(patientsTable).values({
      clinicId: 1, mrn: "MRN-CHK-POS", fullName: "Check Pos", dateOfBirth: "1990-01-01",
      gender: "male", phone: "+1-555-9002",
    }).returning();
    expect(row.clinicId).toBe(1);
  });

  it("rejects INSERT into audit_outbox with clinic_id = 0", async () => {
    await expect(
      (harness.db as any).insert(auditOutboxTable).values({
        clinicId: 0, userId: 1, action: "TEST", entityType: "x", entityId: "1",
      }),
    ).rejects.toThrow(/audit_outbox_clinic_id_positive|check constraint/i);
  });

  it("[symmetry] every clinic-bearing table refuses clinic_id = 0 at the DB layer", async () => {
    const tables = [
      "appointments", "audit_logs", "audit_outbox", "break_glass_sessions", "clinic_notices",
      "doctor_patients", "erasure_requests", "inventory", "invoice_items", "invoices",
      "lab_tests", "medical_records", "notifications", "operations", "patient_consents",
      "patients", "prescriptions", "ultrasound_records", "users", "xray_records",
    ];

    for (const t of tables) {
      const { rows } = await harness.pool.query(
        `SELECT 1 FROM pg_constraint WHERE conname = $1 AND convalidated = true`,
        [`${t}_clinic_id_positive`],
      );
      expect(rows.length, `${t} is missing the CHECK constraint`).toBe(1);
    }
  });
});
