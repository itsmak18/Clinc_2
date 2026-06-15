/**
 * Doctor-scope PHI isolation — REAL Postgres.
 *
 * Doctors may only access patients with whom they have an appointment (see
 * scope.ts, doctor_patients materialized table). The bool-returning guard was
 * converted to a throwing guard on 2026-05-30 (Phase 0.3) — this test pins
 * that behavior against a real DB.
 *
 * Two doctors share a clinic. Doctor A is linked to patient_a only; doctor B
 * to patient_b only. Each must be unable to read the other's patient.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import { hashPassword } from "../lib/password";

let app: any;
let signToken: any;
let harness: RealDbHarness;

interface DoctorScopeSeed {
  clinicId: number;
  doctorA: { id: number; username: string };
  doctorB: { id: number; username: string };
  patientA: { id: number };
  patientB: { id: number };
}

let seed: DoctorScopeSeed;

beforeAll(async () => {
  harness = await startRealDb();

  const {
    clinicsTable, usersTable, patientsTable, appointmentsTable, doctorPatientsTable,
  } = await import("@workspace/db");
  const db = harness.db as any;

  // Seed: one clinic, two doctors, two patients, one appointment each (which
  // populates doctor_patients via the materialized table seed).
  const existing = await db.select({ id: clinicsTable.id }).from(clinicsTable);
  let clinicId: number;
  if (existing.find((r: any) => r.id === 1)) {
    clinicId = 1;
  } else {
    const [c] = await db.insert(clinicsTable).values({ name: "Scope Clinic" }).returning();
    clinicId = c.id;
  }

  const pw = await hashPassword("test_password_123!");
  const [doctorA] = await db.insert(usersTable).values({
    username: "scope_dr_a", fullName: "Scope Doc A", passwordHash: pw, role: "doctor", clinicId,
  }).returning();
  const [doctorB] = await db.insert(usersTable).values({
    username: "scope_dr_b", fullName: "Scope Doc B", passwordHash: pw, role: "doctor", clinicId,
  }).returning();

  const [patientA] = await db.insert(patientsTable).values({
    clinicId, mrn: "MRN-S-A", idCardNumber: "ID-S-A", fullName: "Scope Patient A", dateOfBirth: "1990-01-01",
    gender: "male", phone: "+1-555-1001",
  }).returning();
  const [patientB] = await db.insert(patientsTable).values({
    clinicId, mrn: "MRN-S-B", idCardNumber: "ID-S-B", fullName: "Scope Patient B", dateOfBirth: "1991-02-02",
    gender: "female", phone: "+1-555-1002",
  }).returning();

  // Appointments establish the scope link.
  await db.insert(appointmentsTable).values({
    clinicId, patientId: patientA.id, doctorId: doctorA.id,
    reason: "checkup", scheduledAt: new Date(Date.now() + 86_400_000), status: "scheduled",
  });
  await db.insert(appointmentsTable).values({
    clinicId, patientId: patientB.id, doctorId: doctorB.id,
    reason: "checkup", scheduledAt: new Date(Date.now() + 86_400_000), status: "scheduled",
  });

  // Materialized doctor_patients scope (mirrors what recordDoctorPatientLink does).
  await db.insert(doctorPatientsTable).values([
    { clinicId, doctorId: doctorA.id, patientId: patientA.id, lastSeenAt: new Date() },
    { clinicId, doctorId: doctorB.id, patientId: patientB.id, lastSeenAt: new Date() },
  ]).onConflictDoNothing();

  seed = {
    clinicId,
    doctorA: { id: doctorA.id, username: doctorA.username },
    doctorB: { id: doctorB.id, username: doctorB.username },
    patientA: { id: patientA.id },
    patientB: { id: patientB.id },
  };

  ({ default: app } = await import("../app"));
  ({ signToken } = await import("../lib/auth"));
}, 120_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

async function doctorCookie(d: { id: number; username: string }): Promise<string> {
  const token = await signToken({ userId: d.id, username: d.username, role: "doctor", clinicId: seed.clinicId });
  return `clinic_token=${token}`;
}

describe("Doctor scope PHI isolation (real Postgres)", () => {
  it("Doctor A GET /api/patients/:id of Doctor B's patient → 403 ForbiddenError envelope", async () => {
    const cookie = await doctorCookie(seed.doctorA);
    const res = await request(app).get(`/api/patients/${seed.patientB.id}`).set("Cookie", [cookie]);
    expect(res.status).toBe(403);
    // Phase 0.3: assertPatientInScope now throws ForbiddenError, routed through
    // asyncHandler to the canonical envelope (error_code 3004 / FORBIDDEN).
    expect(res.body.error_code).toBe(3004);
  });

  it("Doctor A GET /api/patients/:id of their own patient → 200", async () => {
    const cookie = await doctorCookie(seed.doctorA);
    const res = await request(app).get(`/api/patients/${seed.patientA.id}`).set("Cookie", [cookie]);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(seed.patientA.id);
  });

  it("[symmetry] Doctor B GET Doctor A's patient → 403", async () => {
    const cookie = await doctorCookie(seed.doctorB);
    const res = await request(app).get(`/api/patients/${seed.patientA.id}`).set("Cookie", [cookie]);
    expect(res.status).toBe(403);
    expect(res.body.error_code).toBe(3004);
  });

  it("Doctor A GET /api/patients/:id/summary of out-of-scope patient → 403", async () => {
    const cookie = await doctorCookie(seed.doctorA);
    const res = await request(app).get(`/api/patients/${seed.patientB.id}/summary`).set("Cookie", [cookie]);
    expect(res.status).toBe(403);
  });
});
