/**
 * Doctor-scope RLS — REAL Postgres.
 *
 * Migration 0017 adds a RESTRICTIVE `doctor_scope` policy to the five PHI
 * tables that are doctor-bounded per CLAUDE.md "Doctor Scope Rule":
 * medical_records, prescriptions, lab_tests, xray_records, ultrasound_records.
 *
 * The policy intersects with `tenant_isolation` (from 0015): doctors only see
 * rows for patients they have a `doctor_patients` link to. Non-doctor roles
 * bypass the doctor clause and rely on tenant_isolation alone.
 *
 * This test verifies all three halves end-to-end against real Postgres:
 *   1. Doctor A reading inside their tenant context returns only their own
 *      patients' medical_records.
 *   2. Doctor A trying to INSERT a medical_record for a patient outside their
 *      scope is rejected by the WITH CHECK clause.
 *   3. A nurse in the same clinic reading inside their context sees every
 *      patient's medical_record (doctor clause bypassed via role).
 *
 * Gated to `pnpm test:integration-db`. Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import { expectDbReject } from "./_helpers/expectDbError";

let harness: RealDbHarness;
let runInTenantContext: typeof import("@workspace/db").runInTenantContext;
let db: typeof import("@workspace/db").db;
let clinicsTable: any;
let usersTable: any;
let patientsTable: any;
let medicalRecordsTable: any;
let doctorPatientsTable: any;

let clinicId: number;
let doctorAId: number;
let doctorBId: number;
let nurseId: number;
let patientAId: number;
let patientBId: number;

beforeAll(async () => {
  harness = await startRealDb();
  ({ runInTenantContext, db, clinicsTable, usersTable, patientsTable, medicalRecordsTable, doctorPatientsTable } = await import("@workspace/db"));

  const existing = (await db.select({ id: clinicsTable.id }).from(clinicsTable)) as Array<{ id: number }>;
  if (existing.find((r) => r.id === 1)) {
    clinicId = 1;
  } else {
    const inserted = (await db.insert(clinicsTable).values({ name: "DocScope Clinic" }).returning()) as Array<{ id: number }>;
    clinicId = inserted[0].id;
  }

  const { hashPassword } = await import("../lib/password");
  const pw = await hashPassword("test_password_123!");

  const [doctorA] = (await db.insert(usersTable).values({
    username: "ds_dr_a", fullName: "DocScope A", passwordHash: pw, role: "doctor", clinicId,
  }).returning()) as Array<{ id: number }>;
  doctorAId = doctorA.id;

  const [doctorB] = (await db.insert(usersTable).values({
    username: "ds_dr_b", fullName: "DocScope B", passwordHash: pw, role: "doctor", clinicId,
  }).returning()) as Array<{ id: number }>;
  doctorBId = doctorB.id;

  const [nurse] = (await db.insert(usersTable).values({
    username: "ds_nurse", fullName: "DocScope Nurse", passwordHash: pw, role: "nurse", clinicId,
  }).returning()) as Array<{ id: number }>;
  nurseId = nurse.id;

  const [pA] = (await db.insert(patientsTable).values({
    clinicId, mrn: "MRN-DS-A", fullName: "DocScope Patient A", dateOfBirth: "1990-01-01",
    gender: "male", phone: "+1-555-4001",
  }).returning()) as Array<{ id: number }>;
  patientAId = pA.id;

  const [pB] = (await db.insert(patientsTable).values({
    clinicId, mrn: "MRN-DS-B", fullName: "DocScope Patient B", dateOfBirth: "1991-02-02",
    gender: "female", phone: "+1-555-4002",
  }).returning()) as Array<{ id: number }>;
  patientBId = pB.id;

  // Materialized scope links: doctor A → patient A only, doctor B → patient B only.
  await db.insert(doctorPatientsTable).values([
    { clinicId, doctorId: doctorAId, patientId: patientAId, lastSeenAt: new Date() },
    { clinicId, doctorId: doctorBId, patientId: patientBId, lastSeenAt: new Date() },
  ]).onConflictDoNothing();

  // One medical record per patient (no PHI encryption — we just need rows to
  // probe the RLS policy; the production encryption layer is orthogonal).
  await db.insert(medicalRecordsTable).values([
    { clinicId, patientId: patientAId, doctorId: doctorAId, chiefComplaint: "checkup A", diagnosis: "ok A", treatment: "n/a" },
    { clinicId, patientId: patientBId, doctorId: doctorBId, chiefComplaint: "checkup B", diagnosis: "ok B", treatment: "n/a" },
  ]);
}, 180_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

describe("Doctor-scope RLS — restrictive policy intersects tenant_isolation", () => {
  it("doctor A INSIDE tenant context sees only their own patient's medical records", async () => {
    const rows = await runInTenantContext(
      { userId: doctorAId, clinicId, role: "doctor" },
      async (tx) => tx.select().from(medicalRecordsTable),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows as Array<{ patientId: number }>) {
      expect(row.patientId, `doctor A saw patient ${row.patientId} (expected only ${patientAId})`).toBe(patientAId);
    }
  });

  it("[symmetry] doctor B INSIDE tenant context sees only patient B's records", async () => {
    const rows = await runInTenantContext(
      { userId: doctorBId, clinicId, role: "doctor" },
      async (tx) => tx.select().from(medicalRecordsTable),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows as Array<{ patientId: number }>) {
      expect(row.patientId).toBe(patientBId);
    }
  });

  it("a NURSE inside the same clinic sees every patient's medical record (doctor clause bypassed)", async () => {
    const rows = await runInTenantContext(
      { userId: nurseId, clinicId, role: "nurse" },
      async (tx) => tx.select().from(medicalRecordsTable),
    );
    const patientIds = new Set((rows as Array<{ patientId: number }>).map((r) => r.patientId));
    expect(patientIds.has(patientAId)).toBe(true);
    expect(patientIds.has(patientBId)).toBe(true);
  });

  it("doctor A INSERT of a medical_record for patient B (out of scope) is rejected by WITH CHECK", async () => {
    await expectDbReject(
      runInTenantContext(
        { userId: doctorAId, clinicId, role: "doctor" },
        async (tx) => tx.insert(medicalRecordsTable).values({
          clinicId, patientId: patientBId, doctorId: doctorAId,
          chiefComplaint: "out-of-scope write attempt", diagnosis: "x", treatment: "x",
        }),
      ),
      /row-level security|new row violates/i,
    );
  });

  // ── Break-glass READ bypass (migration 0024, audit finding F-P2-1) ──────────
  describe("break-glass READ bypass for doctor_scope", () => {
    it("doctor A WITHOUT break-glass cannot READ patient B's records (baseline)", async () => {
      const rows = await runInTenantContext(
        { userId: doctorAId, clinicId, role: "doctor" },
        async (tx) => tx.select().from(medicalRecordsTable),
      );
      const patientIds = new Set((rows as Array<{ patientId: number }>).map((r) => r.patientId));
      expect(patientIds.has(patientBId), "patient B leaked without break-glass").toBe(false);
    });

    it("doctor A WITH an active break-glass session for patient B CAN read patient B's records", async () => {
      const rows = await runInTenantContext(
        { userId: doctorAId, clinicId, role: "doctor" },
        async (tx) => tx.select().from(medicalRecordsTable),
        { breakGlassPatientIds: [patientBId] },
      );
      const patientIds = new Set((rows as Array<{ patientId: number }>).map((r) => r.patientId));
      // Still sees their own patient, and now ALSO the break-glass patient.
      expect(patientIds.has(patientAId)).toBe(true);
      expect(patientIds.has(patientBId), "break-glass did not surface patient B's clinical PHI").toBe(true);
    });

    it("break-glass is READ-only — doctor A still cannot INSERT for patient B under break-glass", async () => {
      await expectDbReject(
        runInTenantContext(
          { userId: doctorAId, clinicId, role: "doctor" },
          async (tx) => tx.insert(medicalRecordsTable).values({
            clinicId, patientId: patientBId, doctorId: doctorAId,
            chiefComplaint: "break-glass write attempt", diagnosis: "x", treatment: "x",
          }),
          { breakGlassPatientIds: [patientBId] },
        ),
        /row-level security|new row violates/i,
      );
    });

    it("break-glass for patient B does NOT widen access to an unrelated patient A's peer", async () => {
      // Sanity: setting break-glass for patient B must not expose any OTHER
      // out-of-scope patient. Doctor A breaks glass on B only; with no third
      // patient seeded, the visible set is exactly {A, B}.
      const rows = await runInTenantContext(
        { userId: doctorAId, clinicId, role: "doctor" },
        async (tx) => tx.select().from(medicalRecordsTable),
        { breakGlassPatientIds: [patientBId] },
      );
      const patientIds = new Set((rows as Array<{ patientId: number }>).map((r) => r.patientId));
      expect([...patientIds].every((id) => id === patientAId || id === patientBId)).toBe(true);
    });
  });
});
