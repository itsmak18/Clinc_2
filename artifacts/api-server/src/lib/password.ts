import bcrypt from "bcrypt";
import { createHash, createHmac } from "crypto";
import { isStrictPasswordPolicyEnabled } from "./auth-constants";

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "12", 10);

// Conservative blocklist — extend via PASSWORD_DICTIONARY_EXTRA env later.
const DICTIONARY_BLOCKLIST = new Set([
  "password", "passw0rd", "p@ssword", "passwd",
  "qwerty", "qwerty123", "asdfgh", "zxcvbn",
  "letmein", "welcome", "admin", "admin123", "administrator",
  "iloveyou", "monkey", "dragon", "trustno1",
  "111111", "123456", "12345678", "123456789", "1234567890",
  "abc123", "abcdef", "654321", "password1",
  "medicore", "clinic", "doctor", "nurse", "hospital",
]);

// ---------------------------------------------------------------------------
// Production password hashing (bcrypt)
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  // Detect legacy HMAC hashes (format: "salt:hash") vs bcrypt (starts with "$2")
  if (storedHash.startsWith("$2")) {
    return bcrypt.compare(password, storedHash);
  }
  // Legacy HMAC-SHA256 fallback for migration
  return verifyLegacyPassword(password, storedHash);
}

/**
 * Check if a stored hash is in the legacy HMAC format and needs re-hashing.
 */
export function isLegacyHash(storedHash: string): boolean {
  return !storedHash.startsWith("$2");
}

// ---------------------------------------------------------------------------
// Legacy HMAC-SHA256 (migration only — will be removed after full migration)
// ---------------------------------------------------------------------------

function verifyLegacyPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const computed = createHmac("sha256", salt).update(password).digest("hex");
  return `${salt}:${computed}` === stored;
}

// ---------------------------------------------------------------------------
// Password strength validation
// ---------------------------------------------------------------------------

export interface PasswordValidation {
  valid: boolean;
  reason?: string;
}

export function validatePasswordStrength(password: string): PasswordValidation {
  const strict = isStrictPasswordPolicyEnabled();
  const minLen = strict ? 12 : 8;

  if (!password || password.length < minLen)
    return { valid: false, reason: `Password must be at least ${minLen} characters long.` };
  if (!/[a-zA-Z]/.test(password))
    return { valid: false, reason: "Password must contain at least one letter." };
  if (!/[0-9]/.test(password))
    return { valid: false, reason: "Password must contain at least one number." };
  if (/^\s|\s$/.test(password))
    return { valid: false, reason: "Password must not start or end with a space." };

  if (strict) {
    if (!/[^A-Za-z0-9]/.test(password))
      return { valid: false, reason: "Password must contain at least one special character." };
    if (DICTIONARY_BLOCKLIST.has(password.toLowerCase()))
      return { valid: false, reason: "This password is too common. Choose something less guessable." };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// HIBP k-anonymity check (Phase 2)
// ---------------------------------------------------------------------------
// Sends only the first 5 chars of the SHA-1 hash to api.pwnedpasswords.com,
// scans the response for the tail. Returns true if the password is found in
// known breach corpora. Fails open: any network error returns false so login
// is not blocked by HIBP outages.

export async function isPasswordPwned(password: string): Promise<boolean> {
  try {
    const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true", "User-Agent": "MediCore-Phase2" },
    });
    if (!res.ok) return false;
    const body = await res.text();
    return body.split("\n").some((line) => line.split(":")[0]?.trim() === suffix);
  } catch {
    return false;
  }
}

/**
 * Full strict validation including HIBP. Async because HIBP is a network call.
 * Use this on password-change / password-reset / new-user-create paths when
 * the strict-policy flag is on. Falls back to sync strength check otherwise.
 */
export async function validatePasswordStrictAsync(
  password: string,
): Promise<PasswordValidation> {
  const sync = validatePasswordStrength(password);
  if (!sync.valid) return sync;
  if (!isStrictPasswordPolicyEnabled()) return sync;

  const pwned = await isPasswordPwned(password);
  if (pwned)
    return {
      valid: false,
      reason: "This password has appeared in a known data breach. Choose another.",
    };

  return { valid: true };
}
