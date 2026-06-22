import { SignJWT, jwtVerify } from "jose";
import { randomUUID, createHash } from "crypto";
import { runtime } from "./runtime";
import { signingKey, jwksVerify, CURRENT_KID } from "./jwt-secret";
import { ROLE_TTL, MAX_ROLE_TTL_SEC } from "./auth-constants";

// ─── Fingerprint model (plan item A1: reconciled 2026-05-26) ────────────────
// Two distinct device-identity concepts coexist; they are complementary, not
// alternatives. Each catches a different attack class:
//
//   1. `fph` — the JWT claim set by signToken() below.
//      Bound to the issuing request (sha256 over UA + Accept-Language, 16 hex).
//      Verified on EVERY request in policy.ts. Catches: stolen-token replay
//      from a different browser/UA. Mandatory at issuance in production (see
//      enforcement below); fail-closed at verification after grandfather
//      window (see policy.ts).
//
//   2. Phase 2 device-trust — HMAC fingerprint + `__Host-device_id` cookie +
//      `user_devices` table. Computed and verified ONLY at login. Catches:
//      password compromise from a new device → forces email verification or
//      blocks privileged roles entirely. Lives in
//      lib/device-fingerprint.ts + services/device-trust.service.ts.
//
// `fph` is per-request token-binding; Phase 2 is per-login device-recognition.
// Together: stealing a token without the matching UA fails (fph); logging in
// from a new browser triggers verification even with correct credentials
// (Phase 2). Removing either weakens a distinct kill chain.
// ─────────────────────────────────────────────────────────────────────────────

export interface TokenPayload {
  userId: number;
  username: string;
  role: string;
  clinicId?: number;
  /** Per-clinic IANA timezone (clinics.timezone), minted at login so server-side
   *  date math (report day-windows, no-show boundaries) uses the clinic's
   *  business day instead of the single env CLINIC_TZ fallback. Optional: legacy
   *  tokens issued before this claim existed fall back to env in getClinicTimezone. */
  timezone?: string;
  fph?: string;
  /** Phase 2: device_unverified — true when login was allowed on a new device
   *  without email confirmation (non-privileged roles, capability-gated session).
   *  Consumed by device-scope middleware to deny PHI bulk reads / exports. */
  dvu?: boolean;
  iat: number;
  exp: number;
  jti: string;
}

export { MAX_ROLE_TTL_SEC };

export function fingerprintRequest(userAgent: string | undefined, acceptLang: string | undefined): string {
  return createHash("sha256")
    .update(`${userAgent ?? ""}|${acceptLang ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

/** Test-only escape hatch — tests issue tokens directly without going through
 *  a request handler. Production code must NEVER pass true. The flag silences
 *  the prod-mandatory-fph check below. */
export interface SignTokenOptions {
  testWithoutFph?: boolean;
}

export async function signToken(
  payload: Omit<TokenPayload, "iat" | "exp" | "jti">,
  requestHeaders?: { "user-agent"?: string; "accept-language"?: string },
  options: SignTokenOptions = {},
): Promise<string> {
  const jti = randomUUID();
  const ttl = ROLE_TTL[payload.role] ?? "4h";
  const ua = requestHeaders?.["user-agent"];
  const al = requestHeaders?.["accept-language"];
  const fph = requestHeaders ? fingerprintRequest(ua, al) : undefined;

  // A1: in production, every issued token MUST carry `fph`. Login-shield
  // already rejects requests with an empty UA in prod (middlewares/login-shield),
  // so the only way `requestHeaders === undefined` reaches here is if a caller
  // forgot to thread headers — that's a bug, fail loud.
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && !options.testWithoutFph) {
    if (!requestHeaders) {
      throw new Error("signToken: requestHeaders required in production (fph mandatory).");
    }
    if (!ua || ua.trim().length === 0) {
      throw new Error("signToken: empty User-Agent — cannot bind fph in production.");
    }
  }

  const token = await new SignJWT({ ...payload, jti, ...(fph ? { fph } : {}) } as Record<string, unknown>)
    .setProtectedHeader({ alg: "EdDSA", kid: CURRENT_KID, typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .setJti(jti)
    .sign(signingKey);

  return token;
}

export async function verifyToken(
  token: string,
  requestHeaders?: { "user-agent"?: string; "accept-language"?: string },
): Promise<TokenPayload> {
  try {
    const { payload } = await jwtVerify(token, jwksVerify, {
      algorithms: ["EdDSA"],
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
      // Fail-closed: revocation store unavailable → reject token (aligns with v7 kernel)
      throw new Error("Token verification unavailable — try again");
    }

    // Fingerprint binding (A1: fail-closed when fph absent, gated by grandfather window).
    // Mirrors policy.ts to keep the legacy verifier honest. The kernel (policy.ts) is
    // the canonical path; this branch covers any non-kernel call site.
    const fingerprintEnabled = process.env.FINGERPRINT_BINDING !== "disabled";
    if (fingerprintEnabled && requestHeaders) {
      if (!payload.fph) {
        const grandfatherUntil = Number(process.env.FPH_GRANDFATHER_UNTIL ?? 0);
        const iat = (payload as { iat?: number }).iat ?? 0;
        if (!(grandfatherUntil > 0 && iat <= grandfatherUntil)) {
          throw new Error("Token fingerprint required");
        }
      } else {
        const currentFph = fingerprintRequest(requestHeaders["user-agent"], requestHeaders["accept-language"]);
        if (currentFph !== payload.fph) {
          throw new Error("Token fingerprint mismatch");
        }
      }
    }

    return payload as unknown as TokenPayload;
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === "JWTExpired") throw new Error("Token expired");
      if (err.message === "Token revoked due to privilege change") throw err;
      if (err.message === "Token fingerprint mismatch") throw err;
      if (err.message === "Token fingerprint required") throw err;
    }
    throw new Error("Invalid token");
  }
}

export async function revokeAllTokensForUser(userId: number): Promise<void> {
  const nowUnix = Math.floor(Date.now() / 1000);
  await runtime.revocationStore.revoke(userId, nowUnix);
}
