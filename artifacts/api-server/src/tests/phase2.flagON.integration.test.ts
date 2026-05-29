/**
 * phase2.flagON.integration.test.ts
 *
 * Flag-ON behavior tests for Phase 2 routes.
 * These tests exercise codepaths that are ONLY active when
 * PHASE2_DEVICE_TRUST_ENABLED=true (and PHASE2_STRICT_PASSWORD_POLICY=true
 * for the password-policy group).
 *
 * Coverage:
 *   POST /auth/verify-device  — fingerprint binding, expired/consumed tokens, success
 *   POST /auth/wasnt-me       — token consume + revocation
 *   POST /auth/login          — role-branched: blocked (202) vs allow_unverified (200)
 *   POST /auth/reset-password — strict password policy, HIBP rejection
 *
 * Design notes:
 * - DB mock is the same thenable-chainable pattern as phase2.integration.test.ts
 *   (prevents DATABASE_URL throw at module load; all DB calls resolve to []).
 * - Service functions are stubbed via vi.spyOn so tests control exact outcomes
 *   without fighting the DB mock's chained-proxy shape.
 * - env vars are set/deleted in beforeEach/afterEach so each test is isolated.
 * - vi.restoreAllMocks() in afterEach undoes every spy regardless of pass/fail.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { createHash } from "crypto";

// ── DB mock (hoisted before app import) ──────────────────────────────────────
vi.mock("@workspace/db", () => {
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
import * as deviceVerificationService from "../services/device-verification.service";
import * as deviceTrustService from "../services/device-trust.service";
import * as authService from "../services/auth.service";
import * as pwResetService from "../services/password-reset.service";

// ── Shared mock token shapes ──────────────────────────────────────────────────

const mockVerificationToken = {
  id: 1,
  userId: 5,
  pendingDeviceId: "550e8400-e29b-41d4-a716-446655440001",
  fingerprintHash: "aabbccddeeff00112233445566778899aabbccdd",
  tokenHash: "irrelevant-hash-stored-in-db",
  consumedAt: null,
  expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  createdAt: new Date(),
};

const mockActiveUser = {
  id: 5,
  username: "dr_ali",
  role: "doctor" as const,
  clinicId: 1,
  fullName: "Dr Ali Hassan",
  fullNameAr: "د علي حسن",
  email: "dr.ali@clinic.example",
  isActive: true,
  isOnShift: false,
  phone: null,
  specialty: null,
  department: null,
  passwordHash: "$2b$12$placeholder",
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Group 1 — POST /auth/verify-device (PHASE2_DEVICE_TRUST_ENABLED=true)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/verify-device (PHASE2_DEVICE_TRUST_ENABLED=true)", () => {
  beforeEach(() => {
    process.env.PHASE2_DEVICE_TRUST_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.PHASE2_DEVICE_TRUST_ENABLED;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns 400 {error:'invalid'} when the token is not found (peekToken → null)", async () => {
    vi.spyOn(deviceVerificationService, "peekToken").mockResolvedValue(null);

    const res = await request(app)
      .post("/api/auth/verify-device")
      .send({ token: "a".repeat(32) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid");
  });

  it("returns 400 {error:'fingerprint_mismatch'} when device fingerprint does not match token", async () => {
    // peekToken succeeds — the attacker knows the token value
    vi.spyOn(deviceVerificationService, "peekToken").mockResolvedValue(mockVerificationToken);
    // consumeVerificationToken rejects because the attacker's device fingerprint differs
    vi.spyOn(deviceVerificationService, "consumeVerificationToken").mockResolvedValue({
      ok: false,
      token: mockVerificationToken,
      reason: "fingerprint_mismatch",
    });

    const res = await request(app)
      .post("/api/auth/verify-device")
      // No User-Agent / Sec-CH-UA-Platform → fingerprint ≠ mockToken.fingerprintHash
      .send({ token: "a".repeat(32) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("fingerprint_mismatch");
  });

  it("returns 400 {error:'expired_or_consumed'} when the token was already used (atomicity)", async () => {
    vi.spyOn(deviceVerificationService, "peekToken").mockResolvedValue(mockVerificationToken);
    // A second concurrent request: UPDATE ... RETURNING [] → token already consumed
    vi.spyOn(deviceVerificationService, "consumeVerificationToken").mockResolvedValue({
      ok: false,
      token: null,
      reason: "expired_or_consumed",
    });

    const res = await request(app)
      .post("/api/auth/verify-device")
      .send({ token: "a".repeat(32) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("expired_or_consumed");
  });

  it("returns 200 with user profile on valid token + matching fingerprint", async () => {
    vi.spyOn(deviceVerificationService, "peekToken").mockResolvedValue(mockVerificationToken);
    vi.spyOn(deviceVerificationService, "consumeVerificationToken").mockResolvedValue({
      ok: true,
      token: mockVerificationToken,
    });
    vi.spyOn(deviceTrustService, "markDeviceTrusted").mockResolvedValue(undefined);
    vi.spyOn(deviceTrustService, "findActiveUserForLogin").mockResolvedValue(mockActiveUser);

    const res = await request(app)
      .post("/api/auth/verify-device")
      .send({ token: "a".repeat(32) });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.username).toBe("dr_ali");
    expect(res.body.user.role).toBe("doctor");
    // A session cookie must be set on successful verification
    const cookies = res.headers["set-cookie"] as string[] | string | undefined;
    const cookieStr = Array.isArray(cookies) ? cookies.join(";") : (cookies ?? "");
    expect(cookieStr).toContain("clinic_token");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2 — POST /auth/wasnt-me (PHASE2_DEVICE_TRUST_ENABLED=true)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/wasnt-me (PHASE2_DEVICE_TRUST_ENABLED=true)", () => {
  beforeEach(() => {
    process.env.PHASE2_DEVICE_TRUST_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.PHASE2_DEVICE_TRUST_ENABLED;
    vi.restoreAllMocks();
  });

  it("returns 400 {error:'expired_or_consumed'} when the token is invalid/expired", async () => {
    vi.spyOn(deviceVerificationService, "consumeVerificationToken").mockResolvedValue({
      ok: false,
      token: null,
      reason: "expired_or_consumed",
    });

    const res = await request(app)
      .post("/api/auth/wasnt-me")
      .send({ token: "a".repeat(32) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("expired_or_consumed");
  });

  it("returns 200 {status:'revoked'} on a valid kill-switch click", async () => {
    // bypassFingerprint=true path — fingerprint is not checked
    vi.spyOn(deviceVerificationService, "consumeVerificationToken").mockResolvedValue({
      ok: true,
      token: mockVerificationToken,
    });
    // lockUserIfPrivileged returns null because the DB mock returns [] for the user select
    // (non-privileged fallback) — no need to spy, the default DB mock handles it

    const res = await request(app)
      .post("/api/auth/wasnt-me")
      .send({ token: "a".repeat(32) });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("revoked");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3 — POST /auth/login role-branched (PHASE2_DEVICE_TRUST_ENABLED=true)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/login — role-branched (PHASE2_DEVICE_TRUST_ENABLED=true)", () => {
  beforeEach(() => {
    process.env.PHASE2_DEVICE_TRUST_ENABLED = "true";
  });
  afterEach(() => {
    delete process.env.PHASE2_DEVICE_TRUST_ENABLED;
    vi.restoreAllMocks();
  });

  it("returns 202 pending_verification for a privileged role on a new device (blocked path)", async () => {
    vi.spyOn(authService, "loginUser").mockResolvedValueOnce({
      outcome: "pending_verification",
      deviceId: "550e8400-e29b-41d4-a716-446655440002",
      message: "Check your email for a verification link to complete sign-in.",
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "dr_ahmed", password: "anyPassword123" });

    expect(res.status).toBe(202);
    expect(res.body.status).toBe("pending_verification");
    expect(typeof res.body.message).toBe("string");
    // No session cookie must be set — the user is not authenticated yet
    const cookies = res.headers["set-cookie"] as string[] | string | undefined;
    const cookieStr = Array.isArray(cookies) ? cookies.join(";") : (cookies ?? "");
    expect(cookieStr).not.toContain("clinic_token");
  });

  it("returns 200 for a non-privileged role on a new device (allow_unverified path)", async () => {
    vi.spyOn(authService, "loginUser").mockResolvedValueOnce({
      outcome: "success",
      token: "fake.jwt.token",
      deviceId: "550e8400-e29b-41d4-a716-446655440003",
      deviceUnverified: true,
      user: {
        id: 9,
        username: "nurse1",
        fullName: "Nurse Fatima",
        fullNameAr: "فاطمة",
        email: "nurse@clinic.example",
        role: "nurse",
        isActive: true,
      },
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ username: "nurse1", password: "anyPassword123" });

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.role).toBe("nurse");
    // The route sets the cookie for allow_unverified too — a session is issued
    const cookies = res.headers["set-cookie"] as string[] | string | undefined;
    const cookieStr = Array.isArray(cookies) ? cookies.join(";") : (cookies ?? "");
    expect(cookieStr).toContain("clinic_token");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4 — POST /auth/reset-password strict policy (PHASE2_STRICT_PASSWORD_POLICY=true)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /auth/reset-password — strict password policy (PHASE2_STRICT_PASSWORD_POLICY=true)", () => {
  beforeEach(() => {
    // isStrictPasswordPolicyEnabled() is gated by isPhase2Enabled() (master flag).
    // Both must be true for the strict checks to fire.
    process.env.PHASE2_DEVICE_TRUST_ENABLED = "true";
    process.env.PHASE2_STRICT_PASSWORD_POLICY = "true";
  });
  afterEach(() => {
    delete process.env.PHASE2_DEVICE_TRUST_ENABLED;
    delete process.env.PHASE2_STRICT_PASSWORD_POLICY;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("returns 400 WEAK_PASSWORD for a password that is shorter than 12 chars (strict minimum)", async () => {
    // "Abc123!@" is 8 chars — passes Zod's min(8) but fails strict mode's min(12).
    // No DB interaction: password check fires and returns before token consume.
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "a".repeat(32), newPassword: "Abc123!@" });

    expect(res.status).toBe(400);
    expect(res.body.error_name).toBe("WEAK_PASSWORD");
    expect(res.body.message).toMatch(/12 characters/i);
  });

  it("returns 400 WEAK_PASSWORD for a password that lacks a special character (strict mode)", async () => {
    // "Abcdefghi123" — 12 chars, has letter + number, but no special char.
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "a".repeat(32), newPassword: "Abcdefghi123" });

    expect(res.status).toBe(400);
    expect(res.body.error_name).toBe("WEAK_PASSWORD");
    expect(res.body.message).toMatch(/special character/i);
  });

  it("returns 400 WEAK_PASSWORD when the password is found in a known breach corpus (HIBP)", async () => {
    // Use a password that passes all sync checks but is "in" HIBP.
    const password = "MySup3rSecure!X";
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const suffix = sha1.slice(5);

    // Mock the global fetch so isPasswordPwned returns true without a real HTTP call.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: async () => `AAAA0:1\n${suffix}:42\nBBBB0:5`,
      }),
    );

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ token: "a".repeat(32), newPassword: password });

    expect(res.status).toBe(400);
    expect(res.body.error_name).toBe("WEAK_PASSWORD");
    expect(res.body.message).toMatch(/breach/i);
  });
});
