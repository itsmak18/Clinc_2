/**
 * Appointment lifecycle correctness — REAL Postgres.
 *
 * Covers two service-level defects the pure-function state-machine unit test
 * (appointment-state-machine.test.ts) cannot reach, because the bugs lived in
 * the service WHERE-clauses, not in validateTransition:
 *
 *   W1 — cancel bypassed the state machine. DELETE /appointments/:id flipped a
 *        terminal completed/no_show back to cancelled, and threw a raw TypeError
 *        on a missing id. cancelAppointment now SELECTs first (→ 404) and routes
 *        through validateTransition (→ 409 on terminal).
 *
 *   W2 — no compare-and-swap. Status writes updated WHERE id AND clinicId with no
 *        status guard, so two concurrent transitions both passed validation
 *        against a stale read and the later write silently won (lost update).
 *        Every status write now adds eq(status, expectedFrom) → 0 rows ⇒ 409.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker (or INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";

let app: any;
let signToken: any;
let harness: RealDbHarness;
let seed: CrossTenantSeed;
let appointmentsTable: any;
let patientsTable: any;

// CSRF double-submit: write-scope mutations require a matching _csrf cookie +
// X-CSRF-Token header (no Origin header needed for same-origin server calls).
const csrf = "appointment-lifecycle-csrf-token";
const writeCookies = (authCookie: string) => [authCookie, `_csrf=${csrf}`];

beforeAll(async () => {
  harness = await startRealDb();

  // Lazy imports — @workspace/db reads DATABASE_URL at module load, which
  // startRealDb() has just set. `import type` above is erased at runtime.
  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);
  ({ appointmentsTable, patientsTable } = await import("@workspace/db"));
  ({ default: app } = await import("../app"));
  ({ signToken } = await import("../lib/auth"));
}, 120_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

async function cookieFor(user: { id: number; username: string; clinicId: number }, role: string): Promise<string> {
  const token = await signToken({ userId: user.id, username: user.username, role, clinicId: user.clinicId });
  return `clinic_token=${token}`;
}

// Seed an appointment directly via the superuser harness (bypasses RLS), in a
// chosen status. scheduledAt is unique per row to satisfy the partial-unique
// no-double-book index on (doctorId, scheduledAt) for active statuses.
let slotSeq = 0;
async function seedAppointment(status: string, patientId: number = seed.patientA.id): Promise<{ id: number }> {
  const scheduledAt = new Date(Date.now() + ++slotSeq * 60_000);
  // `appointmentsTable` is dynamically imported as `any`, so drizzle's return
  // type widens to a non-iterable union — cast the awaited rows to index them.
  const rows = (await harness.db.insert(appointmentsTable).values({
    clinicId: seed.clinicA.id,
    patientId,
    doctorId: seed.doctorA.id,
    scheduledAt,
    reason: `lifecycle-${status}`,
    status: status as any,
  }).returning()) as any[];
  return rows[0];
}

// A clinic-A patient with NO other appointments, so resolveActiveVisit is
// unambiguous (the shared seed.patientA accumulates active rows across tests).
let patientSeq = 0;
async function seedFreshPatient(): Promise<{ id: number }> {
  const n = ++patientSeq;
  const rows = (await harness.db.insert(patientsTable).values({
    clinicId: seed.clinicA.id,
    mrn: `MRN-AF-${n}`, idCardNumber: `ID-AF-${n}`,
    fullName: `Auto Flow Patient ${n}`, dateOfBirth: "1990-01-01",
    gender: "male", phone: `+1-555-9${String(n).padStart(3, "0")}`,
  }).returning()) as any[];
  return rows[0];
}

async function statusOf(id: number): Promise<string> {
  const rows = (await harness.db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id))) as any[];
  return rows[0]?.status;
}

async function rowOf(id: number): Promise<any> {
  const rows = (await harness.db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id))) as any[];
  return rows[0];
}

describe("Cancel routes through the state machine (W1)", () => {
  it("cancelling a completed (terminal) appointment → 409, stays completed", async () => {
    const appt = await seedAppointment("completed");
    const cookie = await cookieFor(seed.superAdminA, "super_admin");

    const res = await request(app)
      .delete(`/api/appointments/${appt.id}`)
      .set("Cookie", writeCookies(cookie))
      .set("X-CSRF-Token", csrf)
      .send({});

    expect(res.status).toBe(409);
    expect(await statusOf(appt.id)).toBe("completed");
  });

  it("cancelling a no_show (terminal) appointment → 409", async () => {
    const appt = await seedAppointment("no_show");
    const cookie = await cookieFor(seed.superAdminA, "super_admin");

    const res = await request(app)
      .delete(`/api/appointments/${appt.id}`)
      .set("Cookie", writeCookies(cookie))
      .set("X-CSRF-Token", csrf)
      .send({});

    expect(res.status).toBe(409);
    expect(await statusOf(appt.id)).toBe("no_show");
  });

  it("cancelling a non-existent appointment → 404 (was a raw TypeError/500)", async () => {
    const cookie = await cookieFor(seed.superAdminA, "super_admin");

    const res = await request(app)
      .delete(`/api/appointments/99999999`)
      .set("Cookie", writeCookies(cookie))
      .set("X-CSRF-Token", csrf)
      .send({});

    expect(res.status).toBe(404);
  });

  it("cancelling an active (checked_in) appointment still succeeds → cancelled", async () => {
    const appt = await seedAppointment("checked_in");
    const cookie = await cookieFor(seed.superAdminA, "super_admin");

    const res = await request(app)
      .delete(`/api/appointments/${appt.id}`)
      .set("Cookie", writeCookies(cookie))
      .set("X-CSRF-Token", csrf)
      .send({ cancellationReason: "patient rescheduled" });

    expect(res.status).toBe(200);
    expect(await statusOf(appt.id)).toBe("cancelled");
  });
});

describe("Concurrent transitions are compare-and-swapped (W2)", () => {
  it("two simultaneous triage calls → exactly one 200 and one 409; final status in_triage", async () => {
    const appt = await seedAppointment("checked_in");
    const cookie = await cookieFor(seed.superAdminA, "super_admin");

    const fire = () =>
      request(app)
        .post(`/api/appointments/${appt.id}/triage`)
        .set("Cookie", writeCookies(cookie))
        .set("X-CSRF-Token", csrf)
        .send({});

    const [r1, r2] = await Promise.all([fire(), fire()]);

    // No lost update: one transition wins, the other is rejected — never both 200.
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    expect(await statusOf(appt.id)).toBe("in_triage");
  });

  it("a stale transition against an already-advanced appointment → 409", async () => {
    // checked_in → triage succeeds; a second triage (now in_triage) is rejected.
    const appt = await seedAppointment("checked_in");
    const cookie = await cookieFor(seed.superAdminA, "super_admin");
    const triage = () =>
      request(app)
        .post(`/api/appointments/${appt.id}/triage`)
        .set("Cookie", writeCookies(cookie))
        .set("X-CSRF-Token", csrf)
        .send({});

    expect((await triage()).status).toBe(200);
    expect((await triage()).status).toBe(409);
    expect(await statusOf(appt.id)).toBe("in_triage");
  });
});

describe("Auto-advance flow projection (Phase 2)", () => {
  let resolveActiveVisit: any;
  let autoAdvanceVisit: any;
  beforeAll(async () => {
    ({ resolveActiveVisit, autoAdvanceVisit } = await import("../services/appointments.service"));
  });

  // The role STRING is what validateTransition gates on; super_admin bypasses the
  // role check so it can drive any action. clinicId scopes runInTenantContext.
  const sysReq = () =>
    ({ user: { userId: seed.superAdminA.id, username: "sa_a", role: "super_admin", clinicId: seed.clinicA.id } } as any);

  it("resolveActiveVisit → the single in-flight visit", async () => {
    const p = await seedFreshPatient();
    const appt = await seedAppointment("in_consultation", p.id);
    expect(await resolveActiveVisit(sysReq(), p.id)).toBe(appt.id);
  });

  it("resolveActiveVisit → null when the patient has >1 active visit (never guess)", async () => {
    const p = await seedFreshPatient();
    await seedAppointment("in_consultation", p.id);
    await seedAppointment("checked_in", p.id);
    expect(await resolveActiveVisit(sysReq(), p.id)).toBeNull();
  });

  it("resolveActiveVisit → null when every visit is terminal", async () => {
    const p = await seedFreshPatient();
    await seedAppointment("completed", p.id);
    expect(await resolveActiveVisit(sysReq(), p.id)).toBeNull();
  });

  it("ordering a study advances in_consultation → awaiting_diagnostics", async () => {
    const p = await seedFreshPatient();
    const appt = await seedAppointment("in_consultation", p.id);
    await autoAdvanceVisit(sysReq(), { patientId: p.id, appointmentId: appt.id, actions: ["diagnostics"] });
    expect(await statusOf(appt.id)).toBe("awaiting_diagnostics");
  });

  it("vitals walk checked_in → ready_for_doctor and stamp triageStartedAt", async () => {
    const p = await seedFreshPatient();
    const appt = await seedAppointment("checked_in", p.id);
    await autoAdvanceVisit(sysReq(), { patientId: p.id, actions: ["triage", "ready"] });
    const row = await rowOf(appt.id);
    expect(row.status).toBe("ready_for_doctor");
    expect(row.triageStartedAt).not.toBeNull();
  });

  it("is idempotent — re-advancing an already-advanced visit is a silent no-op", async () => {
    const p = await seedFreshPatient();
    const appt = await seedAppointment("awaiting_diagnostics", p.id);
    await expect(
      autoAdvanceVisit(sysReq(), { patientId: p.id, appointmentId: appt.id, actions: ["diagnostics"] }),
    ).resolves.toBeUndefined();
    expect(await statusOf(appt.id)).toBe("awaiting_diagnostics");
  });

  it("is non-fatal on an invalid from-state — stays put, never throws", async () => {
    const p = await seedFreshPatient();
    const appt = await seedAppointment("checked_in", p.id);
    // payment requires in_consultation/awaiting_diagnostics — checked_in is invalid.
    await expect(
      autoAdvanceVisit(sysReq(), { patientId: p.id, appointmentId: appt.id, actions: ["payment"] }),
    ).resolves.toBeUndefined();
    expect(await statusOf(appt.id)).toBe("checked_in");
  });

  it("skips when the active visit is ambiguous (no explicit appointmentId)", async () => {
    const p = await seedFreshPatient();
    const a1 = await seedAppointment("in_consultation", p.id);
    const a2 = await seedAppointment("in_consultation", p.id);
    await autoAdvanceVisit(sysReq(), { patientId: p.id, actions: ["diagnostics"] });
    expect(await statusOf(a1.id)).toBe("in_consultation");
    expect(await statusOf(a2.id)).toBe("in_consultation");
  });

  it("does nothing when AUTO_ADVANCE_FLOW=false", async () => {
    const p = await seedFreshPatient();
    const appt = await seedAppointment("in_consultation", p.id);
    const prev = process.env.AUTO_ADVANCE_FLOW;
    process.env.AUTO_ADVANCE_FLOW = "false";
    try {
      await autoAdvanceVisit(sysReq(), { patientId: p.id, appointmentId: appt.id, actions: ["diagnostics"] });
    } finally {
      if (prev === undefined) delete process.env.AUTO_ADVANCE_FLOW;
      else process.env.AUTO_ADVANCE_FLOW = prev;
    }
    expect(await statusOf(appt.id)).toBe("in_consultation");
  });
});

describe("Reconsult reversal (Phase 3)", () => {
  it("resumes the consult: awaiting_diagnostics → in_consultation (200)", async () => {
    const appt = await seedAppointment("awaiting_diagnostics");
    const cookie = await cookieFor(seed.superAdminA, "super_admin");
    const res = await request(app)
      .post(`/api/appointments/${appt.id}/reconsult`)
      .set("Cookie", writeCookies(cookie))
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(res.status).toBe(200);
    expect(await statusOf(appt.id)).toBe("in_consultation");
  });

  it("reconsult from a non-awaiting state → 409 (forward-only guard holds)", async () => {
    const appt = await seedAppointment("ready_for_doctor");
    const cookie = await cookieFor(seed.superAdminA, "super_admin");
    const res = await request(app)
      .post(`/api/appointments/${appt.id}/reconsult`)
      .set("Cookie", writeCookies(cookie))
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(res.status).toBe(409);
    expect(await statusOf(appt.id)).toBe("ready_for_doctor");
  });
});

describe("Vitals separated from medical records (createVitals)", () => {
  let createVitals: any;
  beforeAll(async () => {
    ({ createVitals } = await import("../services/vitals.service"));
  });

  // Nurse role: validateTransition lets nurse drive triage/ready. recordedById is
  // a real clinic-A user; the row's clinic is scoped by runInTenantContext.
  const nurseReq = () =>
    ({ user: { userId: seed.superAdminA.id, username: "nurse", role: "nurse", clinicId: seed.clinicA.id } } as any);

  it("records vitals WITHOUT consent and auto-advances checked_in → ready_for_doctor", async () => {
    const p = await seedFreshPatient();
    const appt = await seedAppointment("checked_in", p.id);
    const row = await createVitals(nurseReq(), {
      patientId: p.id,
      appointmentId: appt.id,
      vitals: { bloodPressureSystolic: 120, bloodPressureDiastolic: 80, heartRate: 72 },
    });
    expect(row.id).toBeTruthy();
    expect(await statusOf(appt.id)).toBe("ready_for_doctor");
  });

  it("rejects physiologically-impossible vitals (strict schema guard)", async () => {
    const p = await seedFreshPatient();
    await expect(
      createVitals(nurseReq(), { patientId: p.id, vitals: { heartRate: 9999 } }),
    ).rejects.toThrow();
  });
});
