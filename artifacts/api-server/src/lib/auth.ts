import { createHmac, randomBytes } from "crypto";

// ---------------------------------------------------------------------------
// JWT Configuration
// ---------------------------------------------------------------------------

const SECRET = process.env.SESSION_SECRET;

if (!SECRET && process.env.NODE_ENV === "production") {
  throw new Error(
    "SESSION_SECRET environment variable is required in production. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}

const JWT_SECRET = SECRET || "clinic-dev-secret-DO-NOT-USE-IN-PROD";

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
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): TokenPayload {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid token");
  const [header, body, sig] = parts;
  const expected = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  if (sig !== expected) throw new Error("Invalid signature");
  const payload: TokenPayload = JSON.parse(fromBase64url(body));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");
  return payload;
}
