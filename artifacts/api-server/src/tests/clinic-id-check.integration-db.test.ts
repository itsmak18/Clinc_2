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
import { expectDbReject } from "./_helpers/expectDbError";

let harness: RealDbHarness;
// Dynamically imported after migrations run.
let patientsTable: any;
let auditOutboxTable: any;
let invoicesTable: any;
let clinicsTable: any;
let usersTable: any;
let notificationsTable: any;

beforeAll(async () => {
  // startRealDb() applies every migration in lib/db/migrations in lexical
  // order — including hand-authored 0010-0013 + the new 0014 — so by the time
  // this resolves the CHECK constraints are in place.
  harness = await startRealDb();
  ({ patientsTable, auditOutboxTable, invoicesTable, clinicsTable, usersTable, notificationsTable } = await import("@workspace/db"));
}, 180_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

describe("clinic_id CHECK constraint (real Postgres)", () => {
  it("rejects INSERT into patients with clinic_id = 0", async () => {
    await expectDbReject(
      (harness.db as any).insert(patientsTable).values({
        clinicId: 0, mrn: "MRN-CHK-0", fullName: "Check 0", dateOfBirth: "1990-01-01",
        gender: "male", phone: "+1-555-9000",
      }),
      /patients_clinic_id_positive|check constraint/i,
    );
  });

  it("rejects INSERT into patients with clinic_id = -1", async () => {
    await expectDbReject(
      (harness.db as any).insert(patientsTable).values({
        clinicId: -1, mrn: "MRN-CHK-NEG", fullName: "Check Neg", dateOfBirth: "1990-01-01",
        gender: "male", phone: "+1-555-9001",
      }),
      /patients_clinic_id_positive|check constraint/i,
    );
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
    await expectDbReject(
      // ip_address is NOT NULL with no default — provide it so the ONLY constraint
      // violated is the clinic_id > 0 CHECK (else this trips NOT NULL first).
      (harness.db as any).insert(auditOutboxTable).values({
        clinicId: 0, userId: 1, action: "TEST", entityType: "x", entityId: "1", ipAddress: "0.0.0.0",
      }),
      /audit_outbox_clinic_id_positive|check constraint/i,
    );
  });

  it("[symmetry] every clinic-bearing table refuses clinic_id = 0 at the DB layer", async () => {
    const tables = [
      "appointments", "audit_logs", "audit_outbox", "break_glass_sessions", "clinic_notices",
      "doctor_patients", "erasure_requests", "inventory", "invoice_items", "invoices",
      "lab_tests", "medical_records", "notifications", "operations", "patient_consents",
      "patients", "prescriptions", "ultrasound_records", "users", "xray_records",
      // Clinic-bearing tables added after migration 0014 (use the `_clinic_id_check`
      // naming): schedules (0022), and the per-clinic invoice counter (0023/0025).
      "doctor_schedules", "schedule_overrides", "clinic_invoice_counters",
    ];

    for (const t of tables) {
      // 0014 named the constraint `{t}_clinic_id_positive`; 0021 (audit_logs
      // partitioning) and 0022/0025 (newer tables) name it `{t}_clinic_id_check`.
      // Accept either — what matters is that a validated CHECK (clinic_id > 0)
      // exists on the table.
      const { rows } = await harness.pool.query(
        `SELECT 1 FROM pg_constraint WHERE conname IN ($1, $2) AND convalidated = true`,
        [`${t}_clinic_id_positive`, `${t}_clinic_id_check`],
      );
      expect(rows.length, `${t} is missing the clinic_id > 0 CHECK constraint`).toBeGreaterThanOrEqual(1);
    }
  });
});

// ── Migration 0027: clinic_id has NO DEFAULT (F-P5-1 hardening) ──────────────
// Before 0027 every clinic-bearing table had `clinic_id ... DEFAULT 1`, so an
// insert that forgot clinicId silently landed in clinic 1 (F-P5-1). After 0027
// the default is gone, so the same omission must fail loudly with NOT NULL (23502)
// instead of mislabeling. These tests prove the schema change reached the DB.
describe("clinic_id has no DEFAULT after migration 0027 (real Postgres)", () => {
  it("rejects INSERT into patients that omits clinic_id (NOT NULL, was silently DEFAULT 1)", async () => {
    // `as any` is required: with the default gone, clinicId is now a required field
    // in Drizzle's insert type — omitting it is exactly the mistake we want the DB
    // to catch at runtime, so we deliberately bypass the compile-time guard here.
    await expectDbReject(
      (harness.db as any).insert(patientsTable).values({
        mrn: "MRN-NODEF-1", fullName: "No Default", dateOfBirth: "1990-01-01",
        gender: "male", phone: "+1-555-9100",
      }),
      /null value in column "clinic_id"|not-null|23502/i,
    );
  });

  it("rejects INSERT into notifications that omits clinic_id (the F-P5-1 site)", async () => {
    await expectDbReject(
      (harness.db as any).insert(notificationsTable).values({
        userId: 1, title: "No clinic", message: "should be rejected", type: "general",
      }),
      /null value in column "clinic_id"|not-null|23502/i,
    );
  });

  it("[symmetry] no clinic-bearing table carries a clinic_id DEFAULT", async () => {
    // The 20 tables that had DEFAULT 1 dropped by 0027. (doctor_schedules /
    // schedule_overrides never had it; clinic_invoice_counters uses clinic_id as PK.)
    const tables = [
      "appointments", "audit_logs", "audit_outbox", "break_glass_sessions", "clinic_notices",
      "doctor_patients", "erasure_requests", "inventory", "invoice_items", "invoices",
      "lab_tests", "medical_records", "notifications", "operations", "patient_consents",
      "patients", "prescriptions", "ultrasound_records", "users", "xray_records",
    ];
    for (const t of tables) {
      const { rows } = await harness.pool.query(
        `SELECT column_default FROM information_schema.columns
           WHERE table_name = $1 AND column_name = 'clinic_id'`,
        [t],
      );
      expect(rows.length, `${t} has no clinic_id column?`).toBe(1);
      expect(rows[0].column_default, `${t}.clinic_id still has a DEFAULT (0027 not applied)`).toBeNull();
    }
  });
});
