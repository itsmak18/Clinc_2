/**
 * Global search doctor-scope isolation — REAL Postgres.
 *
 * Regression for the doctor-scope leak in `globalSearch` (search.service.ts):
 * `/api/search` returned every clinic patient/appointment/record to any doctor,
 * ignoring the doctor_patients scope that listPatients enforces. A doctor must
 * only see search hits within their assigned scope.
 *
 * Two doctors share a clinic with two patients whose names share a common token.
 * Doctor A is linked to patient_a only and must NOT surface patient_b via search.
 *
 * Also pins LIKE-metacharacter escaping: an all-wildcard query must not match
 * everything (the `%`/`_` are escaped to literals, not injected as wildcards).
 *
 * Gated to `pnpm test:integration-db`. Requires Docker (or INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import { hashPassword } from "../lib/password";

let app: any;
let signToken: any;
let harness: RealDbHarness;

interface SearchScopeSeed {
  clinicId: number;
  doctorA: { id: number; username: string };
  doctorB: { id: number; username: string };
  patientA: { id: number };
  patientB: { id: number };
}

let seed: SearchScopeSeed;

// Shared token present in BOTH patient names so a single ILIKE matches both —
// the scope filter is the only thing that should narrow the result to one.
const SHARED_TOKEN = "Zynapatient";

beforeAll(async () => {
  harness = await startRealDb();

  const {
    clinicsTable, usersTable, patientsTable, appointmentsTable, doctorPatientsTable,
  } = await import("@workspace/db");
  const db = harness.db as any;

  const existing = await db.select({ id: clinicsTable.id }).from(clinicsTable);
  let clinicId: number;
  if (existing.find((r: any) => r.id === 1)) {
    clinicId = 1;
  } else {
    const [c] = await db.insert(clinicsTable).values({ name: "Search Scope Clinic" }).returning();
    clinicId = c.id;
  }

  const pw = await hashPassword("test_password_123!");
  const [doctorA] = await db.insert(usersTable).values({
    username: "search_dr_a", fullName: "Search Doc A", passwordHash: pw, role: "doctor", clinicId,
  }).returning();
  const [doctorB] = await db.insert(usersTable).values({
    username: "search_dr_b", fullName: "Search Doc B", passwordHash: pw, role: "doctor", clinicId,
  }).returning();

  const [patientA] = await db.insert(patientsTable).values({
    clinicId, mrn: "MRN-SS-A", idCardNumber: "ID-SS-A", fullName: `${SHARED_TOKEN} Alpha`,
    dateOfBirth: "1990-01-01", gender: "male", phone: "+1-555-2001",
  }).returning();
  const [patientB] = await db.insert(patientsTable).values({
    clinicId, mrn: "MRN-SS-B", idCardNumber: "ID-SS-B", fullName: `${SHARED_TOKEN} Beta`,
    dateOfBirth: "1991-02-02", gender: "female", phone: "+1-555-2002",
  }).returning();

  // Appointments (with a searchable reason) establish the scope link.
  await db.insert(appointmentsTable).values({
    clinicId, patientId: patientA.id, doctorId: doctorA.id,
    reason: `${SHARED_TOKEN} consult`, scheduledAt: new Date(Date.now() + 86_400_000), status: "scheduled",
  });
  await db.insert(appointmentsTable).values({
    clinicId, patientId: patientB.id, doctorId: doctorB.id,
    reason: `${SHARED_TOKEN} consult`, scheduledAt: new Date(Date.now() + 86_400_000), status: "scheduled",
  });

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

async function cookieFor(d: { id: number; username: string }): Promise<string> {
  const token = await signToken({ userId: d.id, username: d.username, role: "doctor", clinicId: seed.clinicId });
  return `clinic_token=${token}`;
}

describe("Global search doctor-scope isolation (real Postgres)", () => {
  it("Doctor A search surfaces ONLY their own patient, not Doctor B's", async () => {
    const cookie = await cookieFor(seed.doctorA);
    const res = await request(app).get(`/api/search?q=${SHARED_TOKEN}`).set("Cookie", [cookie]);
    expect(res.status).toBe(200);

    const patientIds = res.body.patients.map((p: any) => p.id);
    expect(patientIds).toContain(seed.patientA.id);
    expect(patientIds).not.toContain(seed.patientB.id);
  });

  it("Doctor A appointment search excludes Doctor B's patient appointments", async () => {
    const cookie = await cookieFor(seed.doctorA);
    const res = await request(app).get(`/api/search?q=${SHARED_TOKEN}`).set("Cookie", [cookie]);
    expect(res.status).toBe(200);

    // every returned appointment must belong to one of Doctor A's patients
    for (const appt of res.body.appointments) {
      expect(appt.patientMrn).not.toBe("MRN-SS-B");
    }
  });

  it("[symmetry] Doctor B search surfaces ONLY their own patient", async () => {
    const cookie = await cookieFor(seed.doctorB);
    const res = await request(app).get(`/api/search?q=${SHARED_TOKEN}`).set("Cookie", [cookie]);
    expect(res.status).toBe(200);

    const patientIds = res.body.patients.map((p: any) => p.id);
    expect(patientIds).toContain(seed.patientB.id);
    expect(patientIds).not.toContain(seed.patientA.id);
  });

  it("all-wildcard query does not match everything (LIKE metacharacters escaped)", async () => {
    const cookie = await cookieFor(seed.doctorA);
    // '%%' (len 2, passes the min-2 guard) escapes to a literal '%%' substring
    // match — no patient name contains it, so the result is empty rather than all.
    const res = await request(app).get(`/api/search?q=${encodeURIComponent("%%")}`).set("Cookie", [cookie]);
    expect(res.status).toBe(200);
    expect(res.body.patients).toHaveLength(0);
  });
});
