/**
 * policy.unit.test.ts
 *
 * Unit tests for the v7 auth kernel — `evaluate(req, scope, allowedRoles?)`.
 * Covers each scope (public/read/write/privileged), CSRF (origin + double-submit),
 * token presence/parse/revocation/jti/fingerprint/role, and trace invariants.
 *
 * The kernel's RevocationStore dependency is replaced with an in-memory fake.
 * jose's jwtVerify/decodeJwt are mocked so we control the payload.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { errors as joseErrors } from "jose";
import type { Request } from "express";

// ── In-memory RevocationStore double — hoisted with vi.hoisted() so vi.mock
//     can reference it (vi.mock factories run BEFORE module-level consts).
const { fakeRevocationStore } = vi.hoisted(() => {
  const revoked = new Map<number, number>();
  const usedJtis = new Set<string>();
  return {
    fakeRevocationStore: {
      async revoke(userId: number, ts: number) { revoked.set(userId, ts); },
      async getRevokedAt(userId: number) { return revoked.get(userId) ?? null; },
      async isJtiUsed(jti: string) { return usedJtis.has(jti); },
      async markJtiUsed(jti: string) { usedJtis.add(jti); },
      async dispose() { revoked.clear(); usedJtis.clear(); },
      // test helpers
      _setRevokedAt(userId: number, ts: number) { revoked.set(userId, ts); },
      _markJtiUsed(jti: string) { usedJtis.add(jti); },
      _reset() { revoked.clear(); usedJtis.clear(); },
    },
  };
});

vi.mock("../lib/runtime", () => ({
  runtime: { revocationStore: fakeRevocationStore },
}));

// ── jose mock ──────────────────────────────────────────────────────────────
vi.mock("jose", async () => {
  const actual = await vi.importActual<typeof import("jose")>("jose");
  return { ...actual, jwtVerify: vi.fn(), decodeJwt: vi.fn() };
});
import { jwtVerify, decodeJwt } from "jose";
const mockJwtVerify = vi.mocked(jwtVerify);
const mockDecodeJwt = vi.mocked(decodeJwt);

// Import AFTER mocks
import { evaluate } from "../lib/policy";
import { runtime } from "../lib/runtime";
import { E } from "../errors";

// ── Helpers ────────────────────────────────────────────────────────────────
const VALID_PAYLOAD = { userId: 7, username: "u7", role: "doctor", clinicId: 1, iat: 1000, exp: 9999 };

function makeReq(overrides: Record<string, unknown> = {}): Request {
  return {
    method: "GET",
    headers: {},
    cookies: { clinic_token: "tok", _csrf: "csrfval" },
    id: "req-test",
    ...overrides,
  } as unknown as Request;
}

function goodJwt(payload: Record<string, unknown> = {}) {
  mockJwtVerify.mockResolvedValue({ payload: { ...VALID_PAYLOAD, ...payload } } as never);
  mockDecodeJwt.mockReturnValue({ exp: 9999 } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeRevocationStore._reset();
});

// ── Scope: public ──────────────────────────────────────────────────────────
describe("scope: public", () => {
  it("returns ok:true with userId:0 — no token, no CSRF", async () => {
    const d = await evaluate(makeReq({ cookies: {} }), "public");
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.user.userId).toBe(0);
  });
});

// ── CSRF ───────────────────────────────────────────────────────────────────
describe("CSRF (write scope, mutation methods)", () => {
  it("rejects bad Origin → code 1020", async () => {
    const d = await evaluate(
      makeReq({ method: "POST", headers: { origin: "https://evil.com" } }),
      "write",
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(1020);
  });

  it("rejects missing CSRF token/cookie → code 1021", async () => {
    const d = await evaluate(
      makeReq({ method: "POST", headers: {}, cookies: { clinic_token: "tok" } }),
      "write",
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(1021);
  });

  it("rejects CSRF mismatch → code 1022", async () => {
    const d = await evaluate(
      makeReq({
        method: "POST",
        headers: { "x-csrf-token": "aaa" },
        cookies: { clinic_token: "tok", _csrf: "bbb" },
      }),
      "write",
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(1022);
  });

  it("skips CSRF for GET on write scope", async () => {
    goodJwt();
    const d = await evaluate(makeReq({ method: "GET", headers: {} }), "write");
    expect(d.trace.find(s => s.op.startsWith("csrf"))).toBeUndefined();
  });

  it("skips CSRF entirely for read scope POST", async () => {
    goodJwt();
    const d = await evaluate(makeReq({ method: "POST", headers: {} }), "read");
    expect(d.trace.find(s => s.op.startsWith("csrf"))).toBeUndefined();
  });

  it("happy path: valid CSRF + token on POST write → ok:true", async () => {
    goodJwt();
    const d = await evaluate(
      makeReq({ method: "POST", headers: { "x-csrf-token": "csrfval" } }),
      "write",
    );
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.user.userId).toBe(VALID_PAYLOAD.userId);
      expect(d.trace.find(s => s.op === "csrf")?.ok).toBe(true);
    }
  });
});

// ── Token ──────────────────────────────────────────────────────────────────
describe("Token checks", () => {
  it("no clinic_token cookie → code 1001, state anon", async () => {
    const d = await evaluate(makeReq({ cookies: {} }), "read");
    expect(d.ok).toBe(false);
    if (!d.ok) { expect(d.error.code).toBe(1001); expect(d.state).toBe("anon"); }
  });

  it("JWTExpired → code 1002, state expired", async () => {
    mockJwtVerify.mockRejectedValue(new joseErrors.JWTExpired("expired", { exp: 0 } as never));
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(false);
    if (!d.ok) { expect(d.error.code).toBe(1002); expect(d.state).toBe("expired"); }
  });

  it("JWTSignatureVerificationFailed → code 1005, state invalid", async () => {
    mockJwtVerify.mockRejectedValue(new joseErrors.JWTInvalid("bad sig"));
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(false);
    if (!d.ok) { expect(d.error.code).toBe(1005); expect(d.state).toBe("invalid"); }
  });

  it("unknown error → code 1005 fallback", async () => {
    mockJwtVerify.mockRejectedValue(new Error("unexpected"));
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(1005);
  });
});

// ── Revocation ─────────────────────────────────────────────────────────────
describe("Revocation", () => {
  beforeEach(() => goodJwt());

  it("read scope + store throws → ok:true (degrade)", async () => {
    vi.spyOn(runtime.revocationStore, "getRevokedAt").mockRejectedValueOnce(new Error("redis down"));
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(true);
  });

  it("write scope + store throws → ok:false code 1003 (closed)", async () => {
    vi.spyOn(runtime.revocationStore, "getRevokedAt").mockRejectedValueOnce(new Error("redis down"));
    const d = await evaluate(
      makeReq({ method: "POST", headers: { "x-csrf-token": "csrfval" } }),
      "write",
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(1003);
  });

  it("revokedAt >= iat → code 1003, state revoked", async () => {
    fakeRevocationStore._setRevokedAt(VALID_PAYLOAD.userId, 1000); // == iat
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(false);
    if (!d.ok) { expect(d.error.code).toBe(1003); expect(d.state).toBe("revoked"); }
  });
});

// ── jti replay (privileged scope only) ─────────────────────────────────────
describe("jti replay (privileged scope)", () => {
  const PRIV = { ...VALID_PAYLOAD, jti: "jti-abc" };

  beforeEach(() => goodJwt({ jti: "jti-abc" }));

  it("jti already used → code 1006 AUTH_JTI_REPLAYED, state revoked", async () => {
    fakeRevocationStore._markJtiUsed(PRIV.jti);
    const d = await evaluate(
      makeReq({ method: "POST", headers: { "x-csrf-token": "csrfval" } }),
      "privileged",
    );
    expect(d.ok).toBe(false);
    if (!d.ok) { expect(d.error.code).toBe(1006); expect(d.state).toBe("revoked"); }
  });

  it("isJtiUsed throws → code 1003 (fail CLOSED)", async () => {
    vi.spyOn(runtime.revocationStore, "isJtiUsed").mockRejectedValueOnce(new Error("redis down"));
    const d = await evaluate(
      makeReq({ method: "POST", headers: { "x-csrf-token": "csrfval" } }),
      "privileged",
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(1003);
  });

  it("jti absent on token → skip jti step, ok:true", async () => {
    mockJwtVerify.mockResolvedValue({ payload: { ...VALID_PAYLOAD } } as never);
    const d = await evaluate(
      makeReq({ method: "POST", headers: { "x-csrf-token": "csrfval" } }),
      "privileged",
    );
    expect(d.ok).toBe(true);
    expect(d.trace.find(s => s.op === "jti")).toBeUndefined();
  });
});

// ── Fingerprint ────────────────────────────────────────────────────────────
describe("Fingerprint", () => {
  it("fph mismatch → code 1004", async () => {
    goodJwt({ fph: "wrong-fingerprint-value" });
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(E.AUTH_FINGERPRINT.code);
  });

  it("FINGERPRINT_BINDING=disabled bypasses check", async () => {
    const prev = process.env.FINGERPRINT_BINDING;
    process.env.FINGERPRINT_BINDING = "disabled";
    goodJwt({ fph: "would-mismatch" });
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(true);
    process.env.FINGERPRINT_BINDING = prev;
  });

  it("fph absent + iat within grandfather window → passes (legacy token)", async () => {
    // Global test setup sets FPH_GRANDFATHER_UNTIL=9999999999 so every test-issued
    // token is within the grandfather window. This asserts the grandfather branch.
    goodJwt();
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(true);
    expect(d.trace.find(s => s.op === "fingerprint")?.detail).toBe("grandfathered");
  });

  it("[A1] fph absent + no grandfather window → AUTH_FINGERPRINT_REQUIRED (1007)", async () => {
    const prev = process.env.FPH_GRANDFATHER_UNTIL;
    process.env.FPH_GRANDFATHER_UNTIL = "0";
    goodJwt();
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(E.AUTH_FINGERPRINT_REQUIRED.code);
    process.env.FPH_GRANDFATHER_UNTIL = prev;
  });

  it("[A1] fph absent + iat AFTER grandfather cutoff → AUTH_FINGERPRINT_REQUIRED", async () => {
    const prev = process.env.FPH_GRANDFATHER_UNTIL;
    // VALID_PAYLOAD.iat = 1000; cutoff at 999 → token iat > cutoff → fail closed.
    process.env.FPH_GRANDFATHER_UNTIL = "999";
    goodJwt();
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(E.AUTH_FINGERPRINT_REQUIRED.code);
    process.env.FPH_GRANDFATHER_UNTIL = prev;
  });
});

// ── Role ───────────────────────────────────────────────────────────────────
describe("Role check", () => {
  it("nurse on admin-only route → code 1030", async () => {
    goodJwt({ role: "nurse" });
    const d = await evaluate(
      makeReq({ method: "POST", headers: { "x-csrf-token": "csrfval" } }),
      "write",
      ["admin", "super_admin"],
    );
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(1030);
  });

  it("[INVARIANT] super_admin bypasses any allowedRoles list", async () => {
    goodJwt({ role: "super_admin" });
    const d = await evaluate(
      makeReq({ method: "POST", headers: { "x-csrf-token": "csrfval" } }),
      "write",
      ["nurse"], // intentionally excludes super_admin
    );
    expect(d.ok).toBe(true);
  });

  it("[INVARIANT] super_admin bypasses with no allowedRoles passed", async () => {
    goodJwt({ role: "super_admin" });
    const d = await evaluate(
      makeReq({ method: "POST", headers: { "x-csrf-token": "csrfval" } }),
      "write",
    );
    expect(d.ok).toBe(true);
  });
});

// ── Tenancy ────────────────────────────────────────────────────────────────
// The `?? 1` fallback was removed 2026-05-30. Tokens without a positive-integer
// clinicId must fail closed — the previous behavior silently dropped them into
// clinic 1, which is exactly the cross-tenant bug we are closing.
describe("Tenancy check", () => {
  it("token missing clinicId → AUTH_TOKEN_INVALID (1005)", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { userId: 7, username: "u7", role: "doctor", iat: 1000, exp: 9999 },
    } as never);
    mockDecodeJwt.mockReturnValue({ exp: 9999 } as never);
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.error.code).toBe(E.AUTH_INVALID.code);
      expect(d.trace.find(s => s.op === "tenancy")?.ok).toBe(false);
    }
  });

  it("token with clinicId=0 → AUTH_TOKEN_INVALID (1005)", async () => {
    goodJwt({ clinicId: 0 });
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(E.AUTH_INVALID.code);
  });

  it("token with negative clinicId → AUTH_TOKEN_INVALID (1005)", async () => {
    goodJwt({ clinicId: -1 });
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(E.AUTH_INVALID.code);
  });

  it("token with non-integer clinicId → AUTH_TOKEN_INVALID (1005)", async () => {
    goodJwt({ clinicId: 1.5 });
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error.code).toBe(E.AUTH_INVALID.code);
  });

  it("token with positive integer clinicId → user.clinicId populated on success", async () => {
    goodJwt({ clinicId: 42 });
    const d = await evaluate(makeReq(), "read");
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.user.clinicId).toBe(42);
  });
});

// ── Trace ──────────────────────────────────────────────────────────────────
describe("Trace", () => {
  it("trace is frozen (readonly)", async () => {
    goodJwt();
    const d = await evaluate(makeReq(), "read");
    expect(Object.isFrozen(d.trace)).toBe(true);
  });

  it("trace length stays <= 10 (cap)", async () => {
    goodJwt();
    const d = await evaluate(makeReq(), "read");
    expect(d.trace.length).toBeLessThanOrEqual(10);
  });
});
