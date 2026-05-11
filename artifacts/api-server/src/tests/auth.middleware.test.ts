/**
 * auth.middleware.test.ts
 *
 * Tests for requireAuth and requireRole — the RBAC enforcement layer.
 * The super_admin bypass invariant is the primary concern here:
 * super_admin must ALWAYS be allowed, regardless of what roles are passed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Response, NextFunction } from "express";
import { requireAuth, requireRole } from "../../src/middlewares/auth";
import type { AuthRequest } from "../../src/middlewares/auth";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    cookies: {},
    headers: {},
    ...overrides,
  } as unknown as AuthRequest;
}

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

// ── requireRole ───────────────────────────────────────────────────────────────

describe("requireRole", () => {
  let next: NextFunction;
  beforeEach(() => { next = vi.fn(); });

  it("calls next() for a role explicitly listed", () => {
    const req = makeReq({ user: { userId: 1, username: "a", role: "admin" } });
    const res = makeRes();
    requireRole("admin", "nurse")(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 for a role NOT in the list", () => {
    const req = makeReq({ user: { userId: 2, username: "b", role: "lab_staff" } });
    const res = makeRes();
    requireRole("admin", "doctor")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when req.user is absent", () => {
    const req = makeReq({ user: undefined });
    const res = makeRes();
    requireRole("admin")(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  // ── INVARIANT: super_admin bypass ──────────────────────────────────────────

  it("[INVARIANT] super_admin bypasses when roles list is empty", () => {
    const req = makeReq({ user: { userId: 99, username: "sa", role: "super_admin" } });
    const res = makeRes();
    requireRole()(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("[INVARIANT] super_admin bypasses a single-role restriction", () => {
    const req = makeReq({ user: { userId: 99, username: "sa", role: "super_admin" } });
    const res = makeRes();
    requireRole("nurse")(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("[INVARIANT] super_admin bypasses a restrictive multi-role list", () => {
    const req = makeReq({ user: { userId: 99, username: "sa", role: "super_admin" } });
    const res = makeRes();
    requireRole("lab_staff", "xray_staff")(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("[INVARIANT] super_admin is not blocked even if callers forget to include it", () => {
    // This is the regression case: caller accidentally omits 'super_admin'
    const req = makeReq({ user: { userId: 99, username: "sa", role: "super_admin" } });
    const res = makeRes();
    requireRole("front_desk")(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("allows all seven roles when all are listed", () => {
    const roles = ["super_admin", "admin", "doctor", "nurse", "front_desk", "xray_staff", "lab_staff"] as const;
    for (const role of roles) {
      const req = makeReq({ user: { userId: 1, username: "u", role } });
      const res = makeRes();
      const n = vi.fn();
      requireRole(...roles)(req, res, n);
      expect(n).toHaveBeenCalledOnce();
    }
  });
});

// ── requireAuth ───────────────────────────────────────────────────────────────

describe("requireAuth", () => {
  it("returns 401 when no cookie present", async () => {
    const req = makeReq({ cookies: {} });
    const res = makeRes();
    const next = vi.fn();
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when cookie contains invalid token", async () => {
    const req = makeReq({ cookies: { clinic_token: "garbage.token.value" } });
    const res = makeRes();
    const next = vi.fn();
    await requireAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
