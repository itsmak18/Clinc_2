import bcrypt from "bcrypt";
import { createHmac } from "crypto";

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS || "12", 10);

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
  if (!password || password.length < 8)
    return { valid: false, reason: "Password must be at least 8 characters long." };
  if (!/[a-zA-Z]/.test(password))
    return { valid: false, reason: "Password must contain at least one letter." };
  if (!/[0-9]/.test(password))
    return { valid: false, reason: "Password must contain at least one number." };
  if (/^\s|\s$/.test(password))
    return { valid: false, reason: "Password must not start or end with a space." };
  return { valid: true };
}
