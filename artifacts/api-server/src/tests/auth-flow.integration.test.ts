/**
 * auth-flow.integration.test.ts
 *
 * HTTP-level integration tests for the auth + CSRF boundary.
 * These run through the full Express middleware stack (real routing, real CSRF
 * checks, real JWT verification + revocation store) via supertest.
 *
 * Why integration tests here instead of / in addition to mocks:
 *   - csrf.test.ts (unit) tests the middleware in isolation with mock req/res.
 *   - These tests catch mount-point / middleware-ordering bugs that unit tests
 *     can't (e.g. Express stripping "/api" before csrfProtect sees req.path).
 *
 * DB is mocked via vi.mock — auth/CSRF decisions happen before any DB queries;
 * the audit-log insert in the logout handler is wrapped in try/catch anyway.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";

// ── DB mock (hoisted before app import) ──────────────────────────────────────
// Routes import @workspace/db which throws if DATABASE_URL is unset.
// We mock the entire module; the tests only exercise middleware and JWT/revocation
// paths — no real DB operations are needed or expected.
vi.mock("@workspace/db", () => {
  const chainable = () => {
    const obj: Record<string, unknown> = {};
    const handler: ProxyHandler<object> = {
      get: (_t, prop) => {
        if (prop === "then") return undefined; // not a Promise
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
    auditOutboxTable: { id: "id" },
    // drizzle helpers re-exported by @workspace/db
    eq: vi.fn(),
    isNull: vi.fn(),
    and: vi.fn(),
    inArray: vi.fn(),
    sql: vi.fn(),
  };
});

// Import app AFTER mock is registered (vitest hoists vi.mock above this)
import app from "../app";
import { signToken } from "../lib/auth";

// ─────────────────────────────────────────────────────────────────────────────

describe("CSRF boundary — login exemption", () => {
  it("POST /api/auth/login without X-CSRF-Token is NOT blocked by CSRF (returns 400, not 403)", async () => {
    // Empty body → login handler returns 400 before any DB call.
    // If CSRF were not exempt, the response would be 403.
    const res = await request(app)
      .post("/api/auth/login")
      .send({});
    expect(res.status).toBe(400);
    // PR-A2: error shape migrated to canonical envelope. The 400 from a Zod
    // failure now flows through asyncHandler → ValidationError → envelope.
    expect(res.body.message).toMatch(/required/i);
    expect(res.body.error_code).toBe(3003); // DOMAIN_VALIDATION
  });
});

describe("CSRF boundary — logout enforcement", () => {
  it("POST /api/auth/logout without X-CSRF-Token → 403", async () => {
    const token = await signToken({ userId: 8001, username: "testuser", role: "admin", clinicId: 1 });
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", [`clinic_token=${token}`]);
    expect(res.status).toBe(403);
  });

  it("POST /api/auth/logout with mismatched CSRF token → 403", async () => {
    const token = await signToken({ userId: 8002, username: "testuser", role: "admin", clinicId: 1 });
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", [`clinic_token=${token}`, "_csrf=aaaa"])
      .set("X-CSRF-Token", "bbbb");
    expect(res.status).toBe(403);
  });
});

describe("Logout authority — cookie clearance and JWT revocation", () => {
  // Each test uses a distinct userId to avoid cross-test revocation contamination
  // in the shared in-memory revocation store.
  let csrfValue: string;

  beforeEach(() => {
    csrfValue = "integration-test-csrf-deadbeef0123456789abcdef";
  });

  it("successful logout clears clinic_token cookie", async () => {
    const jwt = await signToken({ userId: 9001, username: "u1", role: "nurse", clinicId: 1 });

    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", [`clinic_token=${jwt}`, `_csrf=${csrfValue}`])
      .set("X-CSRF-Token", csrfValue);

    expect(res.status).toBe(200);

    const cookies: string[] = [res.headers["set-cookie"]].flat().filter(Boolean);
    const cleared = cookies.some(
      c => c.startsWith("clinic_token=;") || c.includes("clinic_token=;") || /clinic_token=[^;]*;\s*Max-Age=0/i.test(c),
    );
    expect(cleared).toBe(true);
  });

  it("after logout, the same JWT is rejected server-side (revocation, not just cookie removal)", async () => {
    const jwt = await signToken({ userId: 9002, username: "u2", role: "doctor", clinicId: 1 });

    // Step 1: logout
    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", [`clinic_token=${jwt}`, `_csrf=${csrfValue}`])
      .set("X-CSRF-Token", csrfValue);
    expect(logoutRes.status).toBe(200);

    // Step 2: reuse the same JWT cookie — must be rejected (token was revoked)
    // requireAuth → verifyToken → getRevokedAt(9002) → iat <= revokedAt → 401.
    // This happens before any DB query, so the mocked DB is irrelevant here.
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Cookie", [`clinic_token=${jwt}`]);
    expect(meRes.status).toBe(401);
  });

  it("logout is idempotent — no cookie returns 401 (requireAuth fails), not a crash", async () => {
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Cookie", [`_csrf=${csrfValue}`])
      .set("X-CSRF-Token", csrfValue);
    // No clinic_token cookie → requireAuth → 401 before revocation is attempted
    expect(res.status).toBe(401);
  });
});
