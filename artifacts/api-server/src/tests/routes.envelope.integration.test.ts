/**
 * routes.envelope.integration.test.ts
 *
 * PR-A2 regression guard. For each of the 12 route files migrated from raw
 * `res.status(400).json({error: "..."})` to `throw new ValidationError(...)`,
 * one supertest case sending a request that triggers the previously-raw 400.
 *
 * The assertion is that every response body now matches the canonical envelope
 * (all 7 fields present, correct error_code for DOMAIN_VALIDATION). A future
 * change that reintroduces a raw shape in any of these routes will fail here.
 *
 * inventory.ts and prescriptions.ts are NOT covered — PR-B1 extracts those
 * routes to services and re-routes their validation through asyncHandler.
 * auth.ts has two intentional non-envelope shapes (429 + 401 with custom
 * fields); the migrated 400 path is exercised via the login-empty-body case.
 */

import { describe, it, expect, vi } from "vitest";
import request from "supertest";

// Mock the DB before importing app (same pattern as auth-flow.integration.test.ts).
vi.mock("@workspace/db", () => {
  const chainable = () => {
    const obj: Record<string, unknown> = {};
    const handler: ProxyHandler<object> = {
      get: (_t, prop) => {
        if (prop === "then") return undefined;
        return () => new Proxy({}, handler);
      },
    };
    return new Proxy(obj, handler);
  };
  return {
    db: {
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
      select: vi.fn(() => chainable()),
      update: vi.fn(() => chainable()),
      delete: vi.fn(() => chainable()),
    },
    usersTable: { id: "id", username: "username", deletedAt: "deletedAt", isActive: "isActive" },
    auditLogsTable: { id: "id" },
    eq: vi.fn(),
    isNull: vi.fn(),
    and: vi.fn(),
    inArray: vi.fn(),
    sql: vi.fn(),
  };
});

import app from "../app";
import { signToken } from "../lib/auth";
import { E } from "../errors";

/**
 * Every test below mints a fresh super_admin JWT to bypass role checks and
 * sends it as the `clinic_token` cookie. super_admin auto-bypasses role
 * checks inside the kernel, so each route's `requireRole(...)` accepts.
 *
 * userId is unique per case to avoid revocation-store contamination across
 * tests (the in-memory store is shared).
 */
async function authCookie(userId: number): Promise<string> {
  const token = await signToken({ userId, username: `test${userId}`, role: "super_admin" });
  return `clinic_token=${token}`;
}

function expectValidationEnvelope(body: unknown) {
  expect(body).toMatchObject({
    success: false,
    error_code: E.DOMAIN_VALIDATION.code,
    error_name: E.DOMAIN_VALIDATION.name,
    session_state: expect.stringMatching(/^(authenticated|unauthenticated)$/),
    message: expect.any(String),
    request_id: expect.anything(),
    timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
  });
}

/**
 * Each entry: [routeFile, HTTP verb, path with bad ID, userId for cookie].
 * "abc" as the :id segment trips `safeParseInt` → ValidationError.
 */
const cases: Array<[string, "get" | "post" | "patch" | "delete", string, number]> = [
  ["notifications.ts", "post", "/api/notifications/abc/read", 7001],
  ["xray.ts", "get", "/api/xray/abc", 7002],
  ["lab.ts", "get", "/api/lab/tests/abc", 7003],
  ["operations.ts", "get", "/api/operations/abc", 7004],
  ["ultrasound.ts", "get", "/api/ultrasound/abc", 7005],
  ["medical_records.ts", "get", "/api/medical-records/abc", 7006],
  ["patients.ts", "get", "/api/patients/abc", 7007],
  ["billing.ts", "get", "/api/billing/invoices/abc", 7008],
  ["users.ts", "get", "/api/users/abc", 7009],
  ["schedule.ts", "get", "/api/schedule/doctor/abc", 7010],
  ["appointments.ts", "get", "/api/appointments/abc", 7011],
];

describe("PR-A2: route-level canonical envelope", () => {
  for (const [routeFile, verb, path, userId] of cases) {
    it(`${routeFile} — ${verb.toUpperCase()} ${path} with bad ID → DOMAIN_VALIDATION envelope`, async () => {
      const cookie = await authCookie(userId);
      // GET doesn't trip CSRF; mutations would need _csrf cookie + X-CSRF-Token header
      // (POST /notifications/:id/read is the only mutation here — handled below).
      let req = request(app)[verb](path).set("Cookie", [cookie]);
      if (verb !== "get") {
        const csrf = `csrf-${userId}-deadbeef0123456789`;
        req = request(app)[verb](path)
          .set("Cookie", [cookie, `_csrf=${csrf}`])
          .set("X-CSRF-Token", csrf);
      }
      const res = await req;
      expect(res.status).toBe(E.DOMAIN_VALIDATION.status);
      expectValidationEnvelope(res.body);
    });
  }

  it("auth.ts — POST /api/auth/login with empty body → DOMAIN_VALIDATION envelope (Zod failure)", async () => {
    // Login is CSRF-exempt. Empty body fails the loginSchema parse.
    const res = await request(app).post("/api/auth/login").send({});
    expect(res.status).toBe(E.DOMAIN_VALIDATION.status);
    expectValidationEnvelope(res.body);
    expect(res.body.message).toMatch(/required/i);
  });
});
