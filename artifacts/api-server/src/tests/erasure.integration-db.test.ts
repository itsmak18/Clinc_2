/**
 * Right-to-erasure — REAL Postgres (audit finding F-P3-1).
 *
 * Proves that `executeErasure` actually removes PHI from EVERY clinical table,
 * not just patients + medical_records. Before the fix, prescriptions were only
 * soft-deleted (encrypted `medications` ciphertext retained) and lab/xray/
 * ultrasound rows were untouched (plaintext PHI survived). This test seeds one
 * of each, runs the erasure, and asserts no readable PHI remains.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";

let harness: RealDbHarness;
let executeErasure: typeof import("../services/erasure.service").executeErasure;
let db: any;
let t: any; // table bag

let clinicId: number;
let superAdminId: number;
let doctorId: number;
let patientId: number;
let requestId: number;

function superAdminReq() {
  return {
    user: { userId: superAdminId, username: "sa_erase", role: "super_admin", clinicId },
    ip: "127.0.0.1",
    headers: {},
    socket: {},
  } as any;
}

beforeAll(async () => {
  harness = await startRealDb();
  ({ executeErasure } = await import("../services/erasure.service"));
  t = await import("@workspace/db");
  db = t.db;

  const existing = (await db.select({ id: t.clinicsTable.id }).from(t.clinicsTable)) as Array<{ id: number }>;
  clinicId = existing.find((r) => r.id === 1)?.id
    ?? (await db.insert(t.clinicsTable).values({ name: "Erase Clinic" }).returning())[0].id;

  const { hashPassword } = await import("../lib/password");
  const pw = await hashPassword("test_password_123!");

  [{ id: superAdminId }] = await db.insert(t.usersTable).values({
    username: "sa_erase", fullName: "SA Erase", passwordHash: pw, role: "super_admin", clinicId,
  }).returning({ id: t.usersTable.id });
  [{ id: doctorId }] = await db.insert(t.usersTable).values({
    username: "dr_erase", fullName: "Dr Erase", passwordHash: pw, role: "doctor", clinicId,
  }).returning({ id: t.usersTable.id });

  [{ id: patientId }] = await db.insert(t.patientsTable).values({
    clinicId, mrn: "MRN-ERASE", idCardNumber: "ID-ERASE", fullName: "Erase Me", dateOfBirth: "1980-05-05",
    gender: "male", phone: "+1-555-9999", allergies: "penicillin",
  }).returning({ id: t.patientsTable.id });

  // One PHI-bearing row per clinical table.
  await db.insert(t.medicalRecordsTable).values({
    clinicId, patientId, doctorId, chiefComplaint: "cc", diagnosis: "sensitive dx", treatment: "tx",
  });
  await db.insert(t.prescriptionsTable).values({
    clinicId, patientId, doctorId, medications: "enc:v2:1:aa:bb:cc",
  });
  await db.insert(t.labTestsTable).values({
    clinicId, patientId, requestedById: doctorId, testName: "HIV", results: "POSITIVE",
  });
  await db.insert(t.xrayRecordsTable).values({
    clinicId, patientId, requestedById: doctorId, bodyPart: "chest",
    report: "fracture noted", imageUrl: "https://store/xray.png", imageFileName: "xray.png",
  });
  await db.insert(t.ultrasoundRecordsTable).values({
    clinicId, patientId, requestedById: doctorId, examType: "abdominal", bodyPart: "abdomen",
    report: "mass noted", imageUrl: "https://store/us.png", imageFileName: "us.png",
  });
  await db.insert(t.appointmentsTable).values({
    clinicId, patientId, doctorId, scheduledAt: new Date(), reason: "chest pain", notes: "anxious",
  });

  // An approved erasure request ready to execute.
  [{ id: requestId }] = await db.insert(t.erasureRequestsTable).values({
    clinicId, patientId, requestedByUserId: superAdminId, reason: "patient request to erase",
    status: "approved", reviewedByUserId: superAdminId, reviewedAt: new Date(),
  }).returning({ id: t.erasureRequestsTable.id });
}, 180_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

describe("executeErasure scrubs PHI from every clinical table (F-P3-1)", () => {
  it("runs and reports per-entity counts", async () => {
    const res = await executeErasure(superAdminReq(), requestId);
    expect(res.ok).toBe(true);
    expect(res.erasedCounts.lab_tests).toBeGreaterThan(0);
    expect(res.erasedCounts.xray_records).toBeGreaterThan(0);
    expect(res.erasedCounts.ultrasound_records).toBeGreaterThan(0);
    expect(res.erasedCounts.prescriptions).toBeGreaterThan(0);
    expect(res.erasedCounts.appointments).toBeGreaterThan(0);
  });

  it("leaves NO readable PHI behind in any clinical table", async () => {
    const { eq } = await import("drizzle-orm");

    const [pt] = await db.select().from(t.patientsTable).where(eq(t.patientsTable.id, patientId));
    expect(pt.fullName).toBe("[ERASED]");
    expect(pt.allergies).toBe("[ERASED]");

    const [mr] = await db.select().from(t.medicalRecordsTable).where(eq(t.medicalRecordsTable.patientId, patientId));
    expect(mr.diagnosis).toBe("[ERASED]");

    const [rx] = await db.select().from(t.prescriptionsTable).where(eq(t.prescriptionsTable.patientId, patientId));
    expect(rx.medications).toBe("[ERASED]"); // ciphertext overwritten, not just soft-deleted
    expect(rx.deletedAt).not.toBeNull();

    const [lab] = await db.select().from(t.labTestsTable).where(eq(t.labTestsTable.patientId, patientId));
    expect(lab.results).toBeNull();

    const [xr] = await db.select().from(t.xrayRecordsTable).where(eq(t.xrayRecordsTable.patientId, patientId));
    expect(xr.report).toBeNull();
    expect(xr.imageUrl).toBeNull();
    expect(xr.imageFileName).toBeNull();

    const [us] = await db.select().from(t.ultrasoundRecordsTable).where(eq(t.ultrasoundRecordsTable.patientId, patientId));
    expect(us.report).toBeNull();
    expect(us.imageUrl).toBeNull();

    const [appt] = await db.select().from(t.appointmentsTable).where(eq(t.appointmentsTable.patientId, patientId));
    expect(appt.reason).toBe("[ERASED]");
    expect(appt.notes).toBeNull();
  });
});
