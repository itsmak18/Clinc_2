import { createHmac, randomBytes } from "crypto";

const SECRET = process.env.SESSION_SECRET || "clinic-dev-secret-change-in-prod";

export interface TokenPayload {
  userId: number;
  username: string;
  role: string;
  iat: number;
  exp: number;
}

function base64url(str: string): string {
  return Buffer.from(str).toString("base64url");
}

function fromBase64url(str: string): string {
  return Buffer.from(str, "base64url").toString("utf8");
}

export function signToken(payload: Omit<TokenPayload, "iat" | "exp">): string {
  const now = Math.floor(Date.now() / 1000);
  const full: TokenPayload = { ...payload, iat: now, exp: now + 8 * 3600 };
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(JSON.stringify(full));
  const sig = createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");
  const [header, body, sig] = parts;
  const expected = createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
  if (sig !== expected) throw new Error("Invalid signature");
  const payload: TokenPayload = JSON.parse(fromBase64url(body));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");
  return payload;
}

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt || randomBytes(16).toString("hex");
  const hash = createHmac("sha256", s).update(password).digest("hex");
  return { hash: `${s}:${hash}`, salt: s };
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt] = stored.split(":");
  const { hash } = hashPassword(password, salt);
  return hash === stored;
}

/**
 * Enforce a minimum password policy.
 * Rules: ≥8 chars, at least one letter, at least one digit.
 */
export function validatePasswordStrength(password: string): { valid: boolean; reason?: string } {
  if (!password || password.length < 8)          return { valid: false, reason: "Password must be at least 8 characters long." };
  if (!/[a-zA-Z]/.test(password))                return { valid: false, reason: "Password must contain at least one letter." };
  if (!/[0-9]/.test(password))                   return { valid: false, reason: "Password must contain at least one number." };
  if (/^\s|\s$/.test(password))                  return { valid: false, reason: "Password must not start or end with a space." };
  return { valid: true };
}
