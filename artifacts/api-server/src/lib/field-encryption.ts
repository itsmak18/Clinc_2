/**
 * field-encryption.ts — app-layer AES-256-GCM envelope encryption for PHI fields.
 *
 * Envelope formats stored in the DB column:
 *   v1 (legacy, read-only):  enc:v1:<iv_hex>:<tag_hex>:<data_base64>
 *   v2 (current):            enc:v2:<kid>:<iv_hex>:<tag_hex>:<data_base64>
 *
 * The `kid` (key identifier) slot in v2 makes rotation possible without a
 * stop-the-world re-encryption sweep — new writes carry the active kid, old
 * writes carry their original kid, and as long as both keys remain registered
 * everything decrypts. Lazy re-encryption on the next write of any given row
 * eventually migrates the corpus.
 *
 * Backward compat: values that don't start with "enc:v" are returned unchanged
 * on decrypt (legacy plaintext, dev data). v1 envelopes are decrypted with the
 * kid="1" key — that's the original FIELD_ENCRYPTION_KEY value.
 *
 * Production guard: if no usable key is registered and NODE_ENV=production,
 * this module throws at import time — fail-closed, never silently bypass.
 *
 * Env vars consumed at module init:
 *   FIELD_ENCRYPTION_KEY            — primary key, 64 hex chars (256-bit AES).
 *                                     Registered as kid="1". Also decrypts v1.
 *   FIELD_ENCRYPTION_KEY_NEXT       — optional secondary key (64 hex), registered
 *                                     as kid="2". Used during rotation overlap.
 *   FIELD_ENCRYPTION_KEY_WRITE_KID  — optional; which kid new writes use.
 *                                     Default "1". Set to "2" to make new writes
 *                                     adopt the next key (post-rotation).
 *
 * Rotation playbook lives in SECURITY.md.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { logger } from "./logger";

const ALGO = "aes-256-gcm" as const;
const IV_BYTES = 12;  // 96-bit IV — NIST recommended for GCM
const TAG_BYTES = 16;
const ENVELOPE_PREFIX_V1 = "enc:v1:";
const ENVELOPE_PREFIX_V2 = "enc:v2:";
const KID_RE = /^[A-Za-z0-9_-]{1,16}$/;

// ─── key registry ─────────────────────────────────────────────────────────────

const registry = new Map<string, Buffer>();

function registerKey(kid: string, raw: string | undefined, label: string): void {
  if (!raw) return;
  if (!/^[0-9a-f]{64}$/i.test(raw)) {
    throw new Error(`${label} must be exactly 64 hex characters (256-bit AES key)`);
  }
  registry.set(kid, Buffer.from(raw, "hex"));
}

registerKey("1", process.env.FIELD_ENCRYPTION_KEY, "FIELD_ENCRYPTION_KEY");
registerKey("2", process.env.FIELD_ENCRYPTION_KEY_NEXT, "FIELD_ENCRYPTION_KEY_NEXT");

const WRITE_KID = process.env.FIELD_ENCRYPTION_KEY_WRITE_KID ?? "1";
if (!KID_RE.test(WRITE_KID)) {
  throw new Error(`FIELD_ENCRYPTION_KEY_WRITE_KID must match ${KID_RE} — got: ${WRITE_KID}`);
}

const writeKey = registry.get(WRITE_KID);
if (!writeKey) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      `Active write kid "${WRITE_KID}" is not registered. ` +
      `Set FIELD_ENCRYPTION_KEY (kid=1) or FIELD_ENCRYPTION_KEY_NEXT (kid=2) for that slot.`,
    );
  }
  // dev: encryption disabled if no key — pass-through behavior preserved
  logger.warn(
    "FIELD_ENCRYPTION_KEY is not set — PHI field encryption is DISABLED. " +
    "Set it before handling real patient data.",
  );
}

// ─── envelope detection ───────────────────────────────────────────────────────

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENVELOPE_PREFIX_V1) || value.startsWith(ENVELOPE_PREFIX_V2);
}

// ─── core encrypt / decrypt ───────────────────────────────────────────────────

export function encrypt(plaintext: string): string {
  if (!writeKey) return plaintext;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, writeKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENVELOPE_PREFIX_V2}${WRITE_KID}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("base64")}`;
}

function decryptParts(ivHex: string, tagHex: string, dataB64: string, key: Buffer): string {
  const iv  = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error("Corrupt encrypted field envelope");
  }
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function decrypt(ciphertext: string): string {
  if (!isEncrypted(ciphertext)) return ciphertext;

  if (ciphertext.startsWith(ENVELOPE_PREFIX_V1)) {
    // Legacy envelope, no KID slot — decrypt with the original key (kid="1").
    const key = registry.get("1");
    if (!key) {
      // Without kid="1", legacy rows cannot be decrypted. In dev with no key set
      // we already pass through plaintext above; here we hit a real v1 envelope
      // without a key, which is a config error.
      throw new Error(
        "Cannot decrypt v1 envelope: kid=\"1\" (FIELD_ENCRYPTION_KEY) is not registered. " +
        "Restore the original encryption key to read pre-rotation data.",
      );
    }
    const inner = ciphertext.slice(ENVELOPE_PREFIX_V1.length);
    const colonOne = inner.indexOf(":");
    const colonTwo = inner.indexOf(":", colonOne + 1);
    if (colonOne === -1 || colonTwo === -1) {
      throw new Error("Malformed encrypted field envelope");
    }
    return decryptParts(
      inner.slice(0, colonOne),
      inner.slice(colonOne + 1, colonTwo),
      inner.slice(colonTwo + 1),
      key,
    );
  }

  // v2: enc:v2:<kid>:<iv>:<tag>:<data>
  const inner = ciphertext.slice(ENVELOPE_PREFIX_V2.length);
  const colonKid = inner.indexOf(":");
  if (colonKid === -1) throw new Error("Malformed encrypted field envelope");
  const kid = inner.slice(0, colonKid);
  if (!KID_RE.test(kid)) throw new Error("Malformed encrypted field envelope: invalid kid");
  const key = registry.get(kid);
  if (!key) {
    throw new Error(
      `Cannot decrypt v2 envelope: kid="${kid}" is not registered. ` +
      "Register the matching FIELD_ENCRYPTION_KEY_* env var to read this data.",
    );
  }
  const rest = inner.slice(colonKid + 1);
  const colonOne = rest.indexOf(":");
  const colonTwo = rest.indexOf(":", colonOne + 1);
  if (colonOne === -1 || colonTwo === -1) {
    throw new Error("Malformed encrypted field envelope");
  }
  return decryptParts(
    rest.slice(0, colonOne),
    rest.slice(colonOne + 1, colonTwo),
    rest.slice(colonTwo + 1),
    key,
  );
}

// ─── JSON helpers (for JSONB columns) ────────────────────────────────────────

export function encryptJson(value: unknown): string {
  return encrypt(JSON.stringify(value));
}

export function decryptJson<T = unknown>(ciphertext: string): T {
  return JSON.parse(decrypt(ciphertext)) as T;
}

// ─── nullable helpers (schema columns that can be null) ──────────────────────

export function encryptNullable(value: string | null | undefined): string | null {
  if (value == null) return null;
  return encrypt(value);
}

export function decryptNullable(value: string | null | undefined): string | null {
  if (value == null) return null;
  return decrypt(value);
}

export function encryptJsonNullable(value: unknown): string | null {
  if (value == null) return null;
  return encryptJson(value);
}

export function decryptJsonNullable<T = unknown>(value: string | null | undefined): T | null {
  if (value == null) return null;
  return decryptJson<T>(value as string);
}
