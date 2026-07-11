/**
 * fingerprint-lever.test.ts
 *
 * AUD-SEC-07 / F13 — the two fph emergency levers, centralized in
 * fingerprint-lever.ts. Focus: the production TTL guard on
 * FINGERPRINT_BINDING=disabled (the finding), plus the unchanged dev/test
 * behavior and the self-expiring grandfather window.
 */
import { describe, it, expect, afterEach } from "vitest";
import { fingerprintBypassActive, fphGrandfatherActive } from "../lib/fingerprint-lever";

const NOW = 1_000_000; // fixed unix-seconds "now" for deterministic TTL checks

// Snapshot the env keys this module reads so each case is isolated. The global
// test setup (setup.env.ts) pins NODE_ENV=test and FPH_GRANDFATHER_UNTIL — restore.
const KEYS = ["FINGERPRINT_BINDING", "FINGERPRINT_BINDING_EXPIRES_AT", "NODE_ENV", "FPH_GRANDFATHER_UNTIL"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("fingerprintBypassActive", () => {
  it("returns false when the lever is unset", () => {
    delete process.env.FINGERPRINT_BINDING;
    expect(fingerprintBypassActive(NOW)).toBe(false);
  });

  it("honors disabled unconditionally outside production (dev/test)", () => {
    process.env.NODE_ENV = "test";
    process.env.FINGERPRINT_BINDING = "disabled";
    delete process.env.FINGERPRINT_BINDING_EXPIRES_AT;
    expect(fingerprintBypassActive(NOW)).toBe(true);
  });

  it("REFUSES disabled in production with no TTL (fail-secure)", () => {
    process.env.NODE_ENV = "production";
    process.env.FINGERPRINT_BINDING = "disabled";
    delete process.env.FINGERPRINT_BINDING_EXPIRES_AT;
    expect(fingerprintBypassActive(NOW)).toBe(false);
  });

  it("honors disabled in production while inside the TTL window", () => {
    process.env.NODE_ENV = "production";
    process.env.FINGERPRINT_BINDING = "disabled";
    process.env.FINGERPRINT_BINDING_EXPIRES_AT = String(NOW + 3600);
    expect(fingerprintBypassActive(NOW)).toBe(true);
  });

  it("REFUSES disabled in production once the TTL has expired", () => {
    process.env.NODE_ENV = "production";
    process.env.FINGERPRINT_BINDING = "disabled";
    process.env.FINGERPRINT_BINDING_EXPIRES_AT = String(NOW - 1);
    expect(fingerprintBypassActive(NOW)).toBe(false);
  });
});

describe("fphGrandfatherActive", () => {
  it("is false when the window is unset (0)", () => {
    process.env.FPH_GRANDFATHER_UNTIL = "0";
    expect(fphGrandfatherActive(NOW)).toBe(false);
  });

  it("accepts a token whose iat is at/before the cutoff", () => {
    process.env.FPH_GRANDFATHER_UNTIL = String(NOW);
    expect(fphGrandfatherActive(NOW)).toBe(true);
    expect(fphGrandfatherActive(NOW - 1)).toBe(true);
  });

  it("rejects a token minted after the cutoff", () => {
    process.env.FPH_GRANDFATHER_UNTIL = String(NOW);
    expect(fphGrandfatherActive(NOW + 1)).toBe(false);
  });
});
