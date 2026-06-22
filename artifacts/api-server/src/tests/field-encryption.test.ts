/**
 * field-encryption.test.ts
 *
 * Covers:
 *   - v2 envelope write path: encrypt() produces `enc:v2:<kid>:...` with the
 *     active write kid embedded.
 *   - v1 legacy read path: pre-rotation envelopes (no kid slot) decrypt
 *     correctly via the kid="1" key.
 *   - Multi-kid registry: a v2 envelope tagged with kid="2" decrypts when
 *     FIELD_ENCRYPTION_KEY_NEXT is set, allowing rotation overlap.
 *   - Unknown kid: hard fail with a clear message.
 *   - Tamper detection: corrupted IV or malformed envelope throws.
 *
 * ESM imports are hoisted — module init runs before any top-level test code.
 * Use vi.resetModules() + dynamic import so env vars are set before the
 * module initialises its key registry.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";
import { createCipheriv, randomBytes } from "crypto";

const KEY_PRIMARY = "a".repeat(64); // kid="1"
const KEY_NEXT    = "b".repeat(64); // kid="2"

let encrypt: (s: string) => string;
let decrypt: (s: string) => string;
let isEncrypted: (s: string) => boolean;
let encryptJson: (v: unknown) => string;
let decryptJson: <T>(s: string) => T;
let encryptNullable: (s: string | null | undefined) => string | null;
let decryptNullable: (s: string | null | undefined) => string | null;
let encryptJsonNullable: (v: unknown) => string | null;
let decryptJsonNullable: <T>(s: string | null | undefined) => T | null;
let encryptBuffer: (b: Buffer) => { data: Buffer; kid: string | null; iv: string | null; tag: string | null };
let decryptBuffer: (b: Buffer, env: { kid: string | null; iv: string | null; tag: string | null }) => Buffer;

// Helpers — build legacy v1 / arbitrary-kid v2 envelopes for the tests that
// exercise read-paths we can no longer produce via encrypt() itself.

function buildLegacyV1Envelope(plain: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("hex")}:${tag.toString("hex")}:${data.toString("base64")}`;
}

function buildV2Envelope(plain: string, keyHex: string, kid: string): string {
  const key = Buffer.from(keyHex, "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v2:${kid}:${iv.toString("hex")}:${tag.toString("hex")}:${data.toString("base64")}`;
}

beforeAll(async () => {
  vi.resetModules();
  process.env.FIELD_ENCRYPTION_KEY = KEY_PRIMARY;
  process.env.FIELD_ENCRYPTION_KEY_NEXT = KEY_NEXT;
  delete process.env.FIELD_ENCRYPTION_KEY_WRITE_KID; // default "1"

  const mod = await import("../lib/field-encryption");
  encrypt = mod.encrypt;
  decrypt = mod.decrypt;
  isEncrypted = mod.isEncrypted;
  encryptJson = mod.encryptJson;
  decryptJson = mod.decryptJson;
  encryptNullable = mod.encryptNullable;
  decryptNullable = mod.decryptNullable;
  encryptJsonNullable = mod.encryptJsonNullable;
  decryptJsonNullable = mod.decryptJsonNullable;
  encryptBuffer = mod.encryptBuffer;
  decryptBuffer = mod.decryptBuffer;
});

describe("field-encryption — v2 envelope (current write path)", () => {
  it("encrypts a string to an enc:v2:1: envelope (default write kid)", () => {
    const ct = encrypt("hello");
    expect(ct).toMatch(/^enc:v2:1:/);
    expect(isEncrypted(ct)).toBe(true);
  });

  it("decrypts back to the original plaintext", () => {
    const plain = "Protected Health Information";
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it("produces distinct ciphertexts for the same input (random IV)", () => {
    const a = encrypt("same");
    const b = encrypt("same");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe("same");
    expect(decrypt(b)).toBe("same");
  });

  it("passes through non-encrypted strings unchanged (backward compat)", () => {
    expect(decrypt("plaintext from old record")).toBe("plaintext from old record");
    expect(isEncrypted("plaintext")).toBe(false);
  });

  it("encryptJson/decryptJson round-trips a JSON object", () => {
    const obj = { bloodPressureSystolic: 120, heartRate: 72 };
    const ct = encryptJson(obj);
    expect(isEncrypted(ct)).toBe(true);
    expect(decryptJson(ct)).toEqual(obj);
  });

  it("encryptBuffer/decryptBuffer round-trips binary image bytes", () => {
    // PNG magic header + arbitrary payload — stands in for an uploaded study image.
    const original = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      randomBytes(4096),
    ]);
    const env = encryptBuffer(original);
    expect(env.kid).toBe("1");
    expect(env.iv).toMatch(/^[0-9a-f]{24}$/);  // 12-byte IV in hex
    expect(env.tag).toMatch(/^[0-9a-f]{32}$/); // 16-byte GCM tag in hex
    // Ciphertext on disk must not equal the plaintext (no accidental pass-through).
    expect(env.data.equals(original)).toBe(false);
    const decrypted = decryptBuffer(env.data, env);
    expect(decrypted.equals(original)).toBe(true);
  });

  it("decryptBuffer rejects a tampered GCM tag", () => {
    const env = encryptBuffer(randomBytes(256));
    const badTag = env.tag!.replace(/.$/, c => (c === "0" ? "1" : "0"));
    expect(() => decryptBuffer(env.data, { ...env, tag: badTag })).toThrow();
  });

  it("decryptBuffer passes through when no envelope is present (dev no-key path)", () => {
    const plain = randomBytes(64);
    expect(decryptBuffer(plain, { kid: null, iv: null, tag: null }).equals(plain)).toBe(true);
  });

  it("encryptJson/decryptJson round-trips a JSON array", () => {
    const arr = [{ name: "Metformin", dose: "500mg", frequency: "twice daily" }];
    const ct = encryptJson(arr);
    expect(decryptJson(ct)).toEqual(arr);
  });

  it("encryptNullable returns null for null input", () => {
    expect(encryptNullable(null)).toBeNull();
    expect(encryptNullable(undefined)).toBeNull();
  });

  it("decryptNullable returns null for null input", () => {
    expect(decryptNullable(null)).toBeNull();
  });

  it("encryptJsonNullable returns null for null input", () => {
    expect(encryptJsonNullable(null)).toBeNull();
  });

  it("decryptJsonNullable returns null for null input", () => {
    expect(decryptJsonNullable(null)).toBeNull();
  });
});

describe("field-encryption — v1 legacy read path (pre-rotation rows)", () => {
  it("isEncrypted recognises v1 envelopes", () => {
    const v1 = buildLegacyV1Envelope("legacy patient note", KEY_PRIMARY);
    expect(isEncrypted(v1)).toBe(true);
  });

  it("decrypts v1 envelopes using the kid=\"1\" key", () => {
    const v1 = buildLegacyV1Envelope("legacy patient note", KEY_PRIMARY);
    expect(decrypt(v1)).toBe("legacy patient note");
  });

  it("v1 envelope with wrong key (corrupt or mismatched) throws", () => {
    const v1 = buildLegacyV1Envelope("legacy", KEY_NEXT); // built with kid=2 key, not kid=1
    expect(() => decrypt(v1)).toThrow();
  });
});

describe("field-encryption — v2 multi-kid registry (rotation support)", () => {
  it("decrypts an envelope tagged kid=\"2\" using FIELD_ENCRYPTION_KEY_NEXT", () => {
    const v2k2 = buildV2Envelope("next-key data", KEY_NEXT, "2");
    expect(decrypt(v2k2)).toBe("next-key data");
  });

  it("decrypts an envelope tagged kid=\"1\" using FIELD_ENCRYPTION_KEY", () => {
    // Same shape as encrypt() output, asserted independently
    const v2k1 = buildV2Envelope("primary-key data", KEY_PRIMARY, "1");
    expect(decrypt(v2k1)).toBe("primary-key data");
  });

  it("throws with a clear message on an unknown kid", () => {
    const v2kZ = buildV2Envelope("unknown", KEY_PRIMARY, "99");
    expect(() => decrypt(v2kZ)).toThrow(/kid="99" is not registered/);
  });

  it("rejects a malformed kid (e.g. with colons inside)", () => {
    // Manually construct an invalid kid — KID_RE allows [A-Za-z0-9_-]{1,16}
    // Inserting an unsafe character should fail KID validation, not just
    // bypass to a "kid not registered" lookup.
    const bad = "enc:v2:has spaces:" + "0".repeat(24) + ":" + "0".repeat(32) + ":AAAA";
    expect(() => decrypt(bad)).toThrow(/Malformed/);
  });
});

describe("field-encryption — tamper detection (unchanged from v1)", () => {
  it("[INVARIANT] tampered iv causes decryption to throw", () => {
    const ct = encrypt("sensitive data here");
    // ct = enc:v2:1:<iv>:<tag>:<data>
    const inner = ct.slice("enc:v2:1:".length);
    const parts = inner.split(":");
    const corruptedIv = parts[0].replace(/^./, (c) => (c === "0" ? "1" : "0"));
    const corrupted = `enc:v2:1:${corruptedIv}:${parts[1]}:${parts[2]}`;
    expect(() => decrypt(corrupted)).toThrow();
  });

  it("[INVARIANT] malformed envelope throws on decrypt", () => {
    expect(() => decrypt("enc:v2:1:onlyone")).toThrow();
    expect(() => decrypt("enc:v1:onlyone")).toThrow();
  });
});
