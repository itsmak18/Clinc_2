/**
 * password.test.ts
 *
 * Tests for password hashing, verification, legacy HMAC migration path,
 * and password strength validation.
 *
 * The legacy migration path MUST be covered: a user with an old HMAC hash
 * should be verified correctly, triggering migration to bcrypt on login.
 */
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, isLegacyHash, validatePasswordStrength } from "../lib/password";
import { createHmac } from "crypto";

// ── Helper: create a legacy HMAC-SHA256 hash in the old format ───────────────

function makeLegacyHash(password: string): string {
  const salt = "fixed-test-salt";
  const hash = createHmac("sha256", salt).update(password).digest("hex");
  return `${salt}:${hash}`;
}

// ── hashPassword ──────────────────────────────────────────────────────────────

describe("hashPassword", () => {
  it("produces a bcrypt hash (starts with $2)", async () => {
    const hash = await hashPassword("TestPass1");
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  it("produces different hashes for the same password (salt randomization)", async () => {
    const h1 = await hashPassword("TestPass1");
    const h2 = await hashPassword("TestPass1");
    expect(h1).not.toBe(h2);
  });
});

// ── verifyPassword ────────────────────────────────────────────────────────────

describe("verifyPassword", () => {
  it("verifies correct password against bcrypt hash", async () => {
    const hash = await hashPassword("Correct1");
    expect(await verifyPassword("Correct1", hash)).toBe(true);
  });

  it("rejects wrong password against bcrypt hash", async () => {
    const hash = await hashPassword("Correct1");
    expect(await verifyPassword("Wrong1", hash)).toBe(false);
  });

  it("[LEGACY] verifies correct password against legacy HMAC hash", async () => {
    const legacy = makeLegacyHash("OldPass1");
    expect(await verifyPassword("OldPass1", legacy)).toBe(true);
  });

  it("[LEGACY] rejects wrong password against legacy HMAC hash", async () => {
    const legacy = makeLegacyHash("OldPass1");
    expect(await verifyPassword("WrongPass", legacy)).toBe(false);
  });

  it("[LEGACY] returns false for malformed legacy hash (no colon)", async () => {
    expect(await verifyPassword("anypassword", "nodoublecolon")).toBe(false);
  });
});

// ── isLegacyHash ─────────────────────────────────────────────────────────────

describe("isLegacyHash", () => {
  it("returns false for a bcrypt hash (starts with $2)", async () => {
    const hash = await hashPassword("Test1Pass");
    expect(isLegacyHash(hash)).toBe(false);
  });

  it("returns true for a legacy HMAC hash", () => {
    expect(isLegacyHash(makeLegacyHash("anything"))).toBe(true);
  });

  it("returns true for any string not starting with $2", () => {
    expect(isLegacyHash("salt:hexhash")).toBe(true);
    expect(isLegacyHash("plaintext")).toBe(true);
  });
});

// ── validatePasswordStrength ──────────────────────────────────────────────────

describe("validatePasswordStrength", () => {
  it("accepts a valid password", () => {
    expect(validatePasswordStrength("ValidPass1").valid).toBe(true);
  });

  it("rejects empty string", () => {
    const r = validatePasswordStrength("");
    expect(r.valid).toBe(false);
    expect(r.reason).toBeDefined();
  });

  it("rejects password shorter than 8 characters", () => {
    expect(validatePasswordStrength("Short1").valid).toBe(false);
  });

  it("rejects password with exactly 7 characters (boundary)", () => {
    expect(validatePasswordStrength("Pass123").valid).toBe(false);
  });

  it("accepts password with exactly 8 characters (boundary)", () => {
    expect(validatePasswordStrength("Pass1234").valid).toBe(true);
  });

  it("rejects password with no letters", () => {
    expect(validatePasswordStrength("12345678").valid).toBe(false);
  });

  it("rejects password with no digits", () => {
    expect(validatePasswordStrength("PasswordOnly").valid).toBe(false);
  });

  it("rejects password starting with a space", () => {
    expect(validatePasswordStrength(" Pass1234").valid).toBe(false);
  });

  it("rejects password ending with a space", () => {
    expect(validatePasswordStrength("Pass1234 ").valid).toBe(false);
  });

  it("accepts password with spaces in the middle", () => {
    expect(validatePasswordStrength("Pass 1234").valid).toBe(true);
  });
});
