import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";
import { runtime } from "./runtime";

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

const JWT_SECRET = new TextEncoder().encode(SECRET || "clinic-dev-secret-DO-NOT-USE-IN-PROD");

export interface TokenPayload {
  userId: number;
  username: string;
  role: string;
  iat: number;
  exp: number;
  jti: string;
}

export async function signToken(payload: Omit<TokenPayload, "iat" | "exp" | "jti">): Promise<string> {
  const jti = randomUUID();
  const token = await new SignJWT({ ...payload, jti })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime("8h")
    .setJti(jti)
    .sign(JWT_SECRET);

  return token;
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    });

    // Check if the user's tokens were revoked after this token was issued
    try {
      const revokedAt = await runtime.revocationStore.getRevokedAt(payload.userId as number);
      if (revokedAt !== null && payload.iat && payload.iat <= revokedAt) {
        throw new Error("Token revoked due to privilege change");
      }
    } catch (storeErr) {
      if (storeErr instanceof Error && storeErr.message === "Token revoked due to privilege change") {
        throw storeErr;
      }
      // Fail-open: if the store is unavailable, allow the token but warn
      console.warn("Revocation store unavailable during token check", storeErr);
    }

    return payload as unknown as TokenPayload;
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === "JWTExpired") throw new Error("Token expired");
      if (err.message === "Token revoked due to privilege change") throw err;
    }
    throw new Error("Invalid token");
  }
}

export async function revokeAllTokensForUser(userId: number): Promise<void> {
  const nowUnix = Math.floor(Date.now() / 1000);
  await runtime.revocationStore.revoke(userId, nowUnix);
}
