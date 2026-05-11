/**
 * csrf.test.ts
 *
 * Tests for the CSRF middleware: token presence, mismatch, safe methods,
 * exempt paths, constant-time comparison, and cookie generation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { csrfProtect, setCsrfCookie, clearCsrfCookie } from "../middlewares/csrf";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<{
  method: string;
  path: string;
  cookies: Record<string, string>;
  headers: Record<string, string>;
}> = {}): Request {
  return {
    method: "POST",
    path: "/api/appointments",
    cookies: { _csrf: "valid-token-abc" },
    headers: { "x-csrf-token": "valid-token-abc" },
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

// ── csrfProtect middleware ────────────────────────────────────────────────────

describe("csrfProtect", () => {
  let next: NextFunction;
  beforeEach(() => { next = vi.fn(); });

  it("calls next() when cookie and header match", () => {
    const req = makeReq();
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when header is missing", () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when cookie is missing", () => {
    const req = makeReq({ cookies: {} });
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when cookie and header do not match", () => {
    const req = makeReq({
      cookies: { _csrf: "token-a" },
      headers: { "x-csrf-token": "token-b" },
    });
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 for partial match (one char different)", () => {
    const req = makeReq({
      cookies: { _csrf: "abcdef0123456789" },
      headers: { "x-csrf-token": "abcdef012345678X" },
    });
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  // ── Safe methods are exempt ────────────────────────────────────────────────

  it("skips check for GET (safe method)", () => {
    const req = makeReq({ method: "GET", cookies: {}, headers: {} });
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("skips check for HEAD (safe method)", () => {
    const req = makeReq({ method: "HEAD", cookies: {}, headers: {} });
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("skips check for OPTIONS (safe method)", () => {
    const req = makeReq({ method: "OPTIONS", cookies: {}, headers: {} });
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("enforces check for PATCH", () => {
    const req = makeReq({ method: "PATCH", cookies: {}, headers: {} });
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("enforces check for DELETE", () => {
    const req = makeReq({ method: "DELETE", cookies: {}, headers: {} });
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── Exempt paths ───────────────────────────────────────────────────────────

  it("skips check for /api/auth/login (pre-auth exempt)", () => {
    const req = makeReq({ method: "POST", path: "/api/auth/login", cookies: {}, headers: {} });
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("enforces check for /api/auth/logout (session exists)", () => {
    const req = makeReq({ method: "POST", path: "/api/auth/logout", cookies: {}, headers: {} });
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // ── Error message includes hint ────────────────────────────────────────────

  it("includes hint in 403 response when token missing", () => {
    const req = makeReq({ cookies: {}, headers: {} });
    const res = makeRes();
    csrfProtect(req, res, next);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ hint: expect.stringContaining("X-CSRF-Token") }),
    );
  });
});

// ── setCsrfCookie ─────────────────────────────────────────────────────────────

describe("setCsrfCookie", () => {
  it("returns a non-empty hex token", () => {
    const res = makeRes();
    const token = setCsrfCookie(res);
    expect(typeof token).toBe("string");
    expect(token.length).toBe(64); // 32 bytes → 64 hex chars
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  it("calls res.cookie with httpOnly=false (JS must read it)", () => {
    const res = makeRes();
    setCsrfCookie(res);
    expect(res.cookie).toHaveBeenCalledWith(
      "_csrf",
      expect.any(String),
      expect.objectContaining({ httpOnly: false, sameSite: "strict" }),
    );
  });

  it("generates unique tokens on each call", () => {
    const res1 = makeRes();
    const res2 = makeRes();
    const t1 = setCsrfCookie(res1);
    const t2 = setCsrfCookie(res2);
    expect(t1).not.toBe(t2);
  });
});

// ── clearCsrfCookie ───────────────────────────────────────────────────────────

describe("clearCsrfCookie", () => {
  it("calls res.clearCookie with the _csrf cookie name", () => {
    const res = makeRes();
    clearCsrfCookie(res);
    expect(res.clearCookie).toHaveBeenCalledWith("_csrf", expect.any(Object));
  });
});
