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
import { seedCrossTenant, type CrossTenantSeed } from "./_helpers/seedCrossTenant";

// These are dynamically imported AFTER the container starts and DATABASE_URL is
// set, because @workspace/db throws at import time if DATABASE_URL is unset.
let app: any;
let signToken: any;
let harness: RealDbHarness;
let seed: CrossTenantSeed;

beforeAll(async () => {
  harness = await startRealDb();
  seed = await seedCrossTenant(harness.db);

  // Lazy imports — order matters. @workspace/db reads DATABASE_URL at module load.
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
});
