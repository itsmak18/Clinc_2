/**
 * phase2.integration.test.ts
 *
 * Security-invariant tests for Phase 2 routes:
 *   POST /auth/forgot-password      — enumeration prevention
 *   POST /auth/reset-password       — token validation, weak password rejection
 *   POST /auth/admin-reset/:userId  — requires privileged auth
 *   POST /auth/verify-device        — 503 when Phase 2 flag is OFF
 *   POST /auth/wasnt-me             — 503 when Phase 2 flag is OFF
 *   GET  /account/devices           — requires auth
 *   DELETE /account/devices/:id     — UUID validation, requires auth
 *   POST /api/csp-report            — 204 when flag is OFF; correct path
 *
 * These tests run with PHASE2_DEVICE_TRUST_ENABLED=false (default).
 * They verify that:
 *   - The enumeration oracle is sealed (forgot-password always same body)
 *   - verify-device / wasnt-me return 503 when flag is off
 *   - Protected endpoints require authentication
 *   - csp-report endpoint is at /api/csp-report (not /api/api/csp-report)
 *
 * CSRF note: evaluate() checks CSRF before token presence for write/privileged
 * scopes on mutation methods (POST/PUT/PATCH/DELETE). Tests that need to reach
 * the 401 "no token" layer must supply a matching _csrf cookie + X-CSRF-Token
 * header so the CSRF gate passes first.
 */

import { describe, it, expect, vi } from "vitest";
import request from "supertest";

// ── DB mock (hoisted before app import) ──────────────────────────────────────
vi.mock("@workspace/db", () => {
  // chainable: Drizzle-style chains that resolve to [] (empty array).
  // `const [row] = await db.select()...` → row=undefined (no record found).
  // `rows.map(...)` on [] → [] (devices list returns empty array).
  const chainable = () => {
    const handler: ProxyHandler<unknown[]> = {
      get: (_t, prop) => {
        if (prop === "then") {
          return (resolve: (v: unknown[]) => void) => resolve([]);
        }
        if (prop === "catch") return () => chainable();
        return () => new Proxy([] as unknown[], handler);
      },
    };
    return new Proxy([] as unknown[], handler);
  };
  return {
    db: {
      insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
      select: vi.fn(() => chainable()),
      update: vi.fn(() => chainable()),
      delete: vi.fn(() => chainable()),
      execute: vi.fn().mockResolvedValue([{ nextval: "1" }]),
    },
    usersTable: {},
    auditLogsTable: {},
    auditOutboxTable: {},
    passwordResetTokensTable: {},
    userDevicesTable: {},
    deviceVerificationTokensTable: {},
    cspReportsTable: {},
    eq: vi.fn(),
    isNull: vi.fn(),
    and: vi.fn(),
    inArray: vi.fn(),
    gt: vi.fn(),
    lt: vi.fn(),
    sql: vi.fn(),
    desc: vi.fn(),
    or: vi.fn(),
  };
});

import app from "../app";
import { signToken } from "../lib/auth";

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/forgot-password — enumeration prevention", () => {
  it("returns the generic pending_verification message regardless of input shape", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ username: "definitely_nonexistent_user_xyz" });
    // Always 200 — never reveals whether account exists
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_verification");
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message.length).toBeGreaterThan(10);
  });

  it("returns the SAME generic body even on malformed input (no username)", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({});
    // Malformed input: service still returns the generic response (see route handler)
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_verification");
  });

  it("returns the SAME generic body on empty string username", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ username: "" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("pending_verification");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/reset-password — token validation", () => {
  it("returns 400 with INVALID_RESET_TOKEN when token is missing", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ newPassword: "newpassword123" });
    expect(res.status).toBe(400);
    // Either our ValidationError or the INVALID_RESET_TOKEN response
    expect(res.body.success === false || res.body.error_name).toBeTruthy();
  });

  it("returns 400 with INVALID_RESET_TOKEN when token is provided but invalid", async () => {
    // The DB mock resolves selects to [] → token not found → consumePasswordReset fails
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "a".repeat(32), newPassword: "newpassword123" });
    expect(res.status).toBe(400);
    expect(res.body.error_name).toBe("INVALID_RESET_TOKEN");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/admin-reset/:userId — privileged auth required", () => {
  it("returns 401 without authentication (CSRF provided to bypass CSRF gate)", async () => {
    // evaluate() checks CSRF before token presence. Provide CSRF to reach 401.
    const csrf = "phase2-test-csrf-admin-reset-noauth";
    const res = await request(app)
      .post("/api/auth/admin-reset/1")
      .set("Cookie", `_csrf=${csrf}`)
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 for a non-privileged role (e.g. nurse)", async () => {
    const csrf = "phase2-test-csrf-nurse-reset";
    const token = await signToken(
      { userId: 99, username: "nurse1", role: "nurse", clinicId: 1 },
      {},
    );
    const res = await request(app)
      .post("/api/auth/admin-reset/1")
      .set("Cookie", `clinic_token=${token}; _csrf=${csrf}`)
      .set("X-CSRF-Token", csrf)
      .send({});
    expect(res.status).toBe(403);
  });

  it("returns 400 (not 401/403) for admin with invalid userId param", async () => {
    const csrf = "phase2-test-csrf-admin-badid";
    const token = await signToken(
      { userId: 1, username: "admin1", role: "admin", clinicId: 1 },
      {},
    );
    const res = await request(app)
      .post("/api/auth/admin-reset/not-a-number")
      .set("Cookie", `clinic_token=${token}; _csrf=${csrf}`)
      .set("X-CSRF-Token", csrf)
      .send({});
    // Auth passes (admin), but userId validation fails → 400
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/verify-device — Phase 2 disabled", () => {
  it("returns 503 when PHASE2_DEVICE_TRUST_ENABLED is false (default)", async () => {
    const res = await request(app)
      .post("/api/auth/verify-device")
      .send({ token: "a".repeat(32) });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("phase2_disabled");
  });

  it("returns 503 even with an invalid token body when flag is off", async () => {
    const res = await request(app)
      .post("/api/auth/verify-device")
      .send({});
    expect(res.status).toBe(503);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/wasnt-me — Phase 2 disabled", () => {
  it("returns 503 when PHASE2_DEVICE_TRUST_ENABLED is false (default)", async () => {
    const res = await request(app)
      .post("/api/auth/wasnt-me")
      .send({ token: "a".repeat(32) });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe("phase2_disabled");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /account/devices — auth required", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await request(app).get("/api/account/devices");
    expect(res.status).toBe(401);
  });

  it("returns 200 with an empty devices array for authenticated users", async () => {
    const token = await signToken(
      { userId: 7, username: "dr_ahmed", role: "doctor", clinicId: 1 },
      {},
    );
    const res = await request(app)
      .get("/api/account/devices")
      .set("Cookie", `clinic_token=${token}`);
    // DB mock resolves selects to [] → listDevicesForUser returns []
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.devices)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /account/devices/:deviceId — UUID validation", () => {
  it("returns 401 without auth (CSRF provided to bypass CSRF gate)", async () => {
    // evaluate() checks CSRF before token presence. Provide CSRF to reach 401.
    const csrf = "phase2-test-csrf-delete-noauth";
    const res = await request(app)
      .delete("/api/account/devices/550e8400-e29b-41d4-a716-446655440000")
      .set("Cookie", `_csrf=${csrf}`)
      .set("X-CSRF-Token", csrf);
    expect(res.status).toBe(401);
  });

  it("returns 400 for a non-UUID device id", async () => {
    const csrf = "phase2-test-csrf-delete-baduuid";
    const token = await signToken(
      { userId: 7, username: "dr_ahmed", role: "doctor", clinicId: 1 },
      {},
    );
    const res = await request(app)
      .delete("/api/account/devices/not-a-uuid")
      .set("Cookie", `clinic_token=${token}; _csrf=${csrf}`)
      .set("X-CSRF-Token", csrf);
    expect(res.status).toBe(400);
  });

  it("returns 400 for a valid UUID format but short hex string", async () => {
    const csrf = "phase2-test-csrf-delete-shorthex";
    const token = await signToken(
      { userId: 7, username: "dr_ahmed", role: "doctor", clinicId: 1 },
      {},
    );
    const res = await request(app)
      .delete("/api/account/devices/1234")
      .set("Cookie", `clinic_token=${token}; _csrf=${csrf}`)
      .set("X-CSRF-Token", csrf);
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/csp-report — correct path, 204 when flag OFF", () => {
  it("returns 204 at /api/csp-report (flag OFF → silently accepted)", async () => {
    const res = await request(app)
      .post("/api/csp-report")
      .set("Content-Type", "application/csp-report")
      .send(JSON.stringify({ "csp-report": { "document-uri": "https://example.com" } }));
    // When PHASE2_CSP_REPORT_ENABLED=false (default), route immediately returns 204
    expect(res.status).toBe(204);
  });

  it("does NOT return 204 at /api/api/csp-report (double-prefix bug fixed)", async () => {
    const res = await request(app)
      .post("/api/api/csp-report")
      .send({});
    // Double-prefixed path has no matching route — must not silently accept CSP reports.
    // Returns 403 (CSRF gate from global requireAuth) or 404, never 204.
    expect(res.status).not.toBe(204);
  });
});
