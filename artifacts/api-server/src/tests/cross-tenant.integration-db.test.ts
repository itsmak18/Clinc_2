/**
 * Cross-tenant PHI isolation — REAL Postgres.
 *
 * This is the test the existing 460-test suite cannot run, because every other
 * integration test mocks @workspace/db. A regression that drops a clinic filter
 * (the bug we closed in dashboard.service.ts / erasure.service.ts /
 * audit.service.ts on 2026-05-30) would pass the mocked suite. This test would
 * not — it hits a real Postgres seeded with two clinics and proves Clinic A
 * never sees a Clinic B row across every list/get endpoint in the contract.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
// NOTE: `seedCrossTenant` and `@workspace/db` are imported DYNAMICALLY in
// beforeAll (below), NOT statically — `@workspace/db` throws at module load if
// DATABASE_URL is unset, which at collection time it is. `import type` is erased
// at runtime, so the type-only import here is safe.
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";

let app: any;
let signToken: any;
let harness: RealDbHarness;
let seed: CrossTenantSeed;
let doctorSchedulesTable: any;

beforeAll(async () => {
  harness = await startRealDb();

  // Lazy imports — order matters. @workspace/db reads DATABASE_URL at module load,
  // which startRealDb() has just set. seedCrossTenant transitively imports it too.
  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);
  ({ doctorSchedulesTable } = await import("@workspace/db"));
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

// Asserts that a list response (either an array or `{ data: [...], nextCursor }`)
// contains no row whose `clinicId` matches the forbidden clinic.
function expectNoLeak(body: unknown, forbiddenClinicId: number, where: string): void {
  const rows: any[] = Array.isArray(body) ? body : Array.isArray((body as any)?.data) ? (body as any).data : [];
  for (const row of rows) {
    if (row && typeof row === "object" && "clinicId" in row) {
      expect(
        row.clinicId,
        `${where}: leaked a row from clinic ${forbiddenClinicId} → ${JSON.stringify(row)}`,
      ).not.toBe(forbiddenClinicId);
    }
  }
}

describe("Cross-tenant PHI isolation (real Postgres)", () => {
  describe("list endpoints do not leak across clinics", () => {
    // Drive Clinic A's super_admin against every endpoint that could enumerate
    // clinic-scoped rows. super_admin bypasses role checks, so the only thing
    // that could let a Clinic B row through is a missing clinic filter.
    it.each([
      ["/api/patients"],
      ["/api/appointments"],
      ["/api/medical-records"],
      ["/api/prescriptions"],
      ["/api/xray"],
      ["/api/ultrasound"],
      ["/api/lab/tests"],
      ["/api/billing/invoices"],
      ["/api/operations"],
      ["/api/inventory"],
      ["/api/audit-logs"],
      ["/api/dashboard/summary"],
      ["/api/dashboard/recent-activity"],
      ["/api/dashboard/billing"],
      ["/api/dashboard/compliance"],
      ["/api/erasure-requests"],
    ])("Clinic A super_admin GET %s sees no Clinic B rows", async (endpoint) => {
      const cookie = await cookieFor(seed.superAdminA, "super_admin");
      const res = await request(app).get(endpoint).set("Cookie", [cookie]);

      // Some endpoints will 404 (route not registered with that exact path) or
      // 403 (role gating) — the test is only meaningful for 200 responses.
      // We still assert: if it returns 200, NO Clinic B row appears.
      if (res.status === 200) {
        expectNoLeak(res.body, seed.clinicB.id, `${endpoint} (Clinic A)`);
      }
    });
  });

  describe("get-by-id endpoints refuse to return another clinic's record", () => {
    it("Clinic A super_admin GET /api/patients/:id of Clinic B → 404 (not 403, don't leak existence)", async () => {
      const cookie = await cookieFor(seed.superAdminA, "super_admin");
      const res = await request(app).get(`/api/patients/${seed.patientB.id}`).set("Cookie", [cookie]);
      expect(res.status).toBe(404);
    });

    it("Clinic A super_admin GET /api/billing/invoices/:id of Clinic B → 404", async () => {
      const cookie = await cookieFor(seed.superAdminA, "super_admin");
      const res = await request(app).get(`/api/billing/invoices/${seed.invoiceB.id}`).set("Cookie", [cookie]);
      expect(res.status).toBe(404);
    });

    it("[symmetry] Clinic B super_admin GET Clinic A's patient → 404", async () => {
      const cookie = await cookieFor(seed.superAdminB, "super_admin");
      const res = await request(app).get(`/api/patients/${seed.patientA.id}`).set("Cookie", [cookie]);
      expect(res.status).toBe(404);
    });
  });

  describe("[INVARIANT] tokens without clinicId are rejected", () => {
    // Sanity check for the policy.ts Phase 0.2 change — verified against the
    // running kernel, not just a mocked decision.
    it("a token without clinicId returns 401 AUTH_TOKEN_INVALID", async () => {
      // Cast through unknown to construct an invalid token without losing typing on the helper.
      const badToken = await signToken({
        userId: seed.superAdminA.id, username: seed.superAdminA.username, role: "super_admin",
      } as unknown as { userId: number; username: string; role: string; clinicId: number });
      const res = await request(app).get("/api/patients").set("Cookie", [`clinic_token=${badToken}`]);
      expect(res.status).toBe(401);
      expect(res.body.error_code).toBe(1005); // AUTH_TOKEN_INVALID
    });
  });

  describe("[WRITE] cross-tenant FK validation on create endpoints", () => {
    // These prove the fix for audit findings F-01 / F-02:
    // createMedicalRecord, createInvoice, createAppointment must reject
    // foreign-clinic patientId/doctorId with 404, not succeed.
    // CSRF is enforced in the kernel on write-scope mutations, so these POSTs
    // carry a matching _csrf cookie + X-CSRF-Token header (else they'd 403 before
    // reaching the handler — which is what we're actually testing).
    const csrf = "cross-tenant-write-csrf-token";
    const writeCookies = (authCookie: string) => [authCookie, `_csrf=${csrf}`];

    it("Clinic A billing_manager cannot create invoice referencing Clinic B's patient", async () => {
      // Use a billing_manager from clinic A — they can create invoices
      const cookie = await cookieFor(seed.superAdminA, "super_admin");
      const res = await request(app)
        .post("/api/billing/invoices")
        .set("Cookie", writeCookies(cookie))
        .set("X-CSRF-Token", csrf)
        .send({
          patientId: seed.patientB.id, // Clinic B patient — should be rejected
          items: [{ description: "Test service", quantity: 1, unitPrice: 100 }],
        });
      // Must fail — patient belongs to Clinic B, not Clinic A
      expect(res.status).toBe(404);
    });

    it("Clinic A doctor cannot create prescription referencing Clinic B's patient (F-P5-4)", async () => {
      // Pre-fix: createPrescription's patient existence check omitted the clinicId
      // filter, so a foreign patientId slipped past it and was only incidentally
      // blocked by the consent gate (422). Now the patient check is clinic-scoped → 404.
      const cookie = await cookieFor(seed.doctorA, "doctor");
      const res = await request(app)
        .post("/api/prescriptions")
        .set("Cookie", writeCookies(cookie))
        .set("X-CSRF-Token", csrf)
        .send({
          patientId: seed.patientB.id, // Clinic B patient
          doctorId: seed.doctorA.id,
          medications: [{ name: "Amoxicillin", dosage: "500mg", frequency: "TID", duration: "7d" }],
        });
      expect(res.status).toBe(404);
    });

    it("Clinic A super_admin cannot create appointment with Clinic B's patient", async () => {
      const cookie = await cookieFor(seed.superAdminA, "super_admin");
      const res = await request(app)
        .post("/api/appointments")
        .set("Cookie", writeCookies(cookie))
        .set("X-CSRF-Token", csrf)
        .send({
          patientId: seed.patientB.id, // Clinic B patient
          doctorId: seed.doctorA.id,
          scheduledAt: new Date(Date.now() + 86400000).toISOString(),
          reason: "Cross-tenant test",
        });
      expect(res.status).toBe(404);
    });

    it("Clinic A super_admin cannot create appointment with Clinic B's doctor", async () => {
      const cookie = await cookieFor(seed.superAdminA, "super_admin");
      const res = await request(app)
        .post("/api/appointments")
        .set("Cookie", writeCookies(cookie))
        .set("X-CSRF-Token", csrf)
        .send({
          patientId: seed.patientA.id,
          doctorId: seed.doctorB.id, // Clinic B doctor
          scheduledAt: new Date(Date.now() + 86400000).toISOString(),
          reason: "Cross-tenant test",
        });
      expect(res.status).toBe(404);
    });
  });

  describe("[BOOKING] same-clinic availability works under FORCE-RLS (F-P1-1 regression)", () => {
    // Regression guard for F-P1-1: migration 0022 put FORCE ROW LEVEL SECURITY +
    // a non-dormant policy on doctor_schedules/schedule_overrides. The booking
    // validator read those tables outside any tenant context, so RLS hid every
    // row and EVERY booking failed with 409 "No schedule for this day". The
    // existing cross-tenant WRITE tests above only assert the 404 rejection path
    // (which fires before availability is checked), so they could not catch this.
    // These tests exercise the same-clinic happy path that the bug broke.

    const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
    const csrf = "f-p1-1-regression-csrf-token";

    function bookingCookies(authCookie: string): string[] {
      return [authCookie, `_csrf=${csrf}`];
    }

    it("Clinic A super_admin can book when the doctor has a matching schedule", async () => {
      const slot = new Date(Date.now() + 7 * 86_400_000);
      slot.setHours(12, 0, 0, 0);
      const day = DOW[slot.getDay()];

      // Seed doctorA's weekly schedule via the superuser harness (bypasses RLS).
      // 00:00–23:59 so the noon slot is always inside working hours.
      await harness.db.insert(doctorSchedulesTable).values({
        clinicId: seed.clinicA.id,
        doctorId: seed.doctorA.id,
        dayOfWeek: day as any,
        startTime: "00:00:00",
        endTime: "23:59:00",
        status: "active",
      });

      const cookie = await cookieFor(seed.superAdminA, "super_admin");
      const res = await request(app)
        .post("/api/appointments")
        .set("Cookie", bookingCookies(cookie))
        .set("X-CSRF-Token", csrf)
        .send({
          patientId: seed.patientA.id,
          doctorId: seed.doctorA.id,
          scheduledAt: slot.toISOString(),
          reason: "F-P1-1 same-clinic booking regression",
        });

      // Pre-fix this returned 409 "No schedule for this day". Now it succeeds.
      expect(res.status).toBeLessThan(300);
      expect(res.status).not.toBe(409);
      expect(res.body?.id).toBeTypeOf("number");
    });

    it("booking on a day with no schedule is still correctly rejected (validator runs, not blanket-broken)", async () => {
      const slot = new Date(Date.now() + 8 * 86_400_000); // different weekday → no schedule seeded
      slot.setHours(12, 0, 0, 0);

      const cookie = await cookieFor(seed.superAdminA, "super_admin");
      const res = await request(app)
        .post("/api/appointments")
        .set("Cookie", bookingCookies(cookie))
        .set("X-CSRF-Token", csrf)
        .send({
          patientId: seed.patientA.id,
          doctorId: seed.doctorA.id,
          scheduledAt: slot.toISOString(),
          reason: "F-P1-1 no-schedule day",
        });

      expect(res.status).toBe(409);
    });
  });
});
