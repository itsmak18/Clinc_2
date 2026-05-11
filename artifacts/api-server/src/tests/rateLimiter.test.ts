/**
 * rateLimiter.test.ts
 *
 * Tests for the rate limiter middleware and functions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ipRateLimit, getRemainingAttempts, checkAllowed, recordSuccess } from "../../src/middlewares/rateLimiter";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(ip: string = "127.0.0.1"): Request {
  return { ip } as Request;
}

function makeRes() {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

// ── Mock DB ──────────────────────────────────────────────────────────────────
const { mockWhere, mockDeleteWhere } = vi.hoisted(() => ({
  mockWhere: vi.fn(),
  mockDeleteWhere: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const dbMock = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: mockWhere,
    delete: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
  };
  // To support db.delete(table).where(...)
  dbMock.delete.mockReturnValue({ where: mockDeleteWhere });

  return {
    db: dbMock,
    loginAttemptsTable: { key: "key" },
  };
});

// ── ipRateLimit middleware ────────────────────────────────────────────────────

describe("ipRateLimit", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
    // Use vi.useFakeTimers if we wanted to test expiration precisely,
    // but we can just test the counts easily.
  });

  it("allows requests under the limit", () => {
    const middleware = ipRateLimit(3, 60000);
    const req = makeReq("192.168.1.1");
    const res = makeRes();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);

    middleware(req, res, next);
    expect(next).toHaveBeenCalledTimes(2);

    expect(res.status).not.toHaveBeenCalled();
  });

  it("blocks requests over the limit and returns 429", () => {
    const middleware = ipRateLimit(2, 60000);
    const req = makeReq("192.168.1.2");
    const res = makeRes();

    middleware(req, res, next); // 1st allowed
    middleware(req, res, next); // 2nd allowed
    middleware(req, res, next); // 3rd blocked

    expect(next).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.json).toHaveBeenCalledWith({
      error: "Too many requests. Please try again later.",
    });
  });

  it("tracks IPs independently", () => {
    const middleware = ipRateLimit(1, 60000);
    const req1 = makeReq("10.0.0.1");
    const req2 = makeReq("10.0.0.2");
    const res = makeRes();

    middleware(req1, res, next); // IP1 allowed
    expect(next).toHaveBeenCalledTimes(1);

    middleware(req1, res, next); // IP1 blocked
    expect(res.status).toHaveBeenCalledWith(429);

    middleware(req2, res, next); // IP2 allowed (independent)
    expect(next).toHaveBeenCalledTimes(2);
  });
});

// ── DB-backed rate limiter functions ──────────────────────────────────────────

describe("DB-backed rate limiter functions", () => {
  beforeEach(() => {
    mockWhere.mockReset();
    mockDeleteWhere.mockReset();
  });

  it("getRemainingAttempts returns MAX_ATTEMPTS if no row exists", async () => {
    mockWhere.mockResolvedValueOnce([]); // No row
    const remaining = await getRemainingAttempts("test-key");
    expect(remaining).toBe(5); // MAX_ATTEMPTS = 5
  });

  it("getRemainingAttempts returns correct remaining amount", async () => {
    mockWhere.mockResolvedValueOnce([{ count: 2 }]);
    const remaining = await getRemainingAttempts("test-key");
    expect(remaining).toBe(3); // 5 - 2 = 3
  });

  it("checkAllowed allows if no row exists", async () => {
    mockWhere.mockResolvedValueOnce([]); // No row
    const result = await checkAllowed("test-key");
    expect(result.allowed).toBe(true);
  });

  it("checkAllowed blocks if actively locked", async () => {
    const futureDate = new Date(Date.now() + 10000); // locked for 10s
    mockWhere.mockResolvedValueOnce([{ lockedUntil: futureDate, firstSeen: new Date() }]);
    const result = await checkAllowed("test-key");
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSecs).toBeGreaterThan(0);
  });

  it("recordSuccess deletes the tracking row", async () => {
    await recordSuccess("test-key");
    expect(mockDeleteWhere).toHaveBeenCalled();
  });
});
