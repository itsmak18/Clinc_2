/**
 * policy.ts — the v7 auth kernel.
 *
 * Single function `evaluate(req, scope, allowedRoles?)` is the source of truth
 * for CSRF + identity + revocation + jti replay + fingerprint + role. Returns
 * a Decision discriminated union; `sendDecision()` is the only allowed way to
 * translate a failed Decision into an HTTP response.
 */
import { jwtVerify, decodeJwt, errors as joseErrors } from "jose";
import { timingSafeEqual } from "crypto";
import type { Request, Response } from "express";
import { runtime } from "./runtime";
import { logger } from "./logger";
import { fingerprintRequest, type TokenPayload } from "./auth";
import { jwksVerify } from "./jwt-secret";
import { E, type ErrorDef } from "../errors";

export type Scope = "public" | "read" | "write" | "privileged";

export interface AuthUser {
  userId: number;
  username: string;
  role: string;
  clinicId: number;
}

export interface AuthMeta {
  sessionTtl: number | null;
}

export type SessionState = "anon" | "expired" | "revoked" | "invalid" | "authenticated";

export interface Step {
  op: string;
  ok: boolean;
  detail?: string;
}

export type Decision =
  | { ok: true;  user: AuthUser; meta: AuthMeta;       trace: readonly Step[] }
  | { ok: false; error: ErrorDef; state: SessionState; trace: readonly Step[] };

// ─── helpers ────────────────────────────────────────────────────────────────

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
function isMutation(method: string): boolean { return MUTATION_METHODS.has(method.toUpperCase()); }


async function parseToken(token: string): Promise<TokenPayload> {
  const { payload } = await jwtVerify(token, jwksVerify, {
    algorithms: ["EdDSA"],
    clockTolerance: 30, // guards against NTP drift between nodes
  });
  return payload as unknown as TokenPayload;
}

function extractTokenTtl(token: string): number | null {
  try {
    const p = decodeJwt(token);
    if (!p.exp) return null;
    return Math.max(0, Math.floor(p.exp - Date.now() / 1000));
  } catch {
    return null;
  }
}

// Parsed once at module load — re-reading per-call buys nothing.
const ALLOWED_ORIGINS_SET: string[] = (() => {
  const fromEnv = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const replit = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .map(d => `https://${d}`);
  if (process.env.NODE_ENV !== "production") {
    return [...fromEnv, ...replit, "http://localhost:5173", "http://127.0.0.1:5173"];
  }
  return [...fromEnv, ...replit];
})();

function originAllowed(origin: string): boolean {
  try {
    const { protocol, hostname, port } = new URL(origin);
    return ALLOWED_ORIGINS_SET.some(o => {
      try {
        const a = new URL(o);
        return protocol === a.protocol && hostname === a.hostname && port === a.port;
      } catch { return false; }
    });
  } catch { return false; }
}

// ─── kernel ─────────────────────────────────────────────────────────────────

export async function evaluate(
  req: Request,
  scope: Scope,
  allowedRoles?: string[],
): Promise<Decision> {
  const steps: Step[] = [];
  function step(op: string, ok: boolean, detail?: string): void {
    if (steps.length < 10) steps.push({ op, ok, detail });
  }
  function fail(error: ErrorDef, state: SessionState): Decision {
    return { ok: false, error, state, trace: Object.freeze([...steps]) };
  }
  function pass(user: AuthUser, meta: AuthMeta): Decision {
    return { ok: true, user, meta, trace: Object.freeze([...steps]) };
  }

  // 1. Public scope: no checks
  if (scope === "public") {
    return pass({ userId: 0, username: "public", role: "public", clinicId: 0 }, { sessionTtl: null });
  }

  // 2. CSRF (write + privileged, mutation methods only)
  if ((scope === "write" || scope === "privileged") && isMutation(req.method)) {
    const origin = req.headers.origin as string | undefined;
    if (origin && !originAllowed(origin)) {
      step("csrf_origin", false, origin);
      return fail(E.AUTH_CSRF_ORIGIN, "invalid");
    }
    const headerToken = req.headers["x-csrf-token"] as string | undefined;
    const cookieToken = (req.cookies as Record<string, string> | undefined)?.["_csrf"];
    if (!headerToken || !cookieToken) {
      step("csrf_missing", false);
      return fail(E.AUTH_CSRF_MISSING, "invalid");
    }
    const tBuf = Buffer.from(headerToken);
    const cBuf = Buffer.from(cookieToken);
    if (tBuf.length !== cBuf.length || !timingSafeEqual(tBuf, cBuf)) {
      step("csrf_mismatch", false);
      return fail(E.AUTH_CSRF_MISMATCH, "invalid");
    }
    step("csrf", true);
  }

  // 3. Token presence
  const rawToken = (req.cookies as Record<string, string> | undefined)?.["clinic_token"];
  if (!rawToken) { step("token_present", false); return fail(E.AUTH_NO_TOKEN, "anon"); }

  // 4. Token parse
  let payload: TokenPayload;
  try {
    payload = await parseToken(rawToken);
    step("token_parsed", true);
  } catch (e: unknown) {
    const expired = e instanceof joseErrors.JWTExpired;
    step("token_parsed", false, e instanceof Error ? e.message : "unknown");
    return fail(expired ? E.AUTH_EXPIRED : E.AUTH_INVALID, expired ? "expired" : "invalid");
  }

  // 5a. jti single-use check (privileged scope only)
  if (scope === "privileged" && payload.jti) {
    try {
      const used = await runtime.revocationStore.isJtiUsed(payload.jti);
      if (used) {
        step("jti", false, "replayed");
        return fail(E.AUTH_JTI_REPLAYED, "revoked");
      }
      step("jti", true);
    } catch {
      step("jti", false, "store-unavailable:closed");
      return fail(E.AUTH_REVOKED, "revoked");
    }
  }

  // 5b. Revocation check (policy determined by scope)
  try {
    const revokedAt = await runtime.revocationStore.getRevokedAt(payload.userId);
    if (revokedAt !== null && payload.iat <= revokedAt) {
      step("revocation", false, "iat<=revokedAt");
      return fail(E.AUTH_REVOKED, "revoked");
    }
    step("revocation", true);
  } catch {
    if (scope === "read") {
      step("revocation", true, "store-unavailable:degrade");
      logger.warn({ request_id: req.id, op: "revocation", detail: "degrade" });
    } else {
      step("revocation", false, "store-unavailable:closed");
      return fail(E.AUTH_REVOKED, "revoked");
    }
  }

  // 6. Fingerprint check (A1: mandatory at issuance, fail-closed at verification)
  //
  //   FINGERPRINT_BINDING=disabled      → operator incident-recovery lever; skips
  //                                       the check entirely. Use only during a
  //                                       widespread silent-UA-change incident.
  //   FPH_GRANDFATHER_UNTIL=<unix-secs> → tokens whose iat is <= this value are
  //                                       allowed to lack `fph` (covers the
  //                                       deploy window where pre-A1 tokens are
  //                                       still in active cookies). Tokens
  //                                       issued AFTER the cutoff with no fph
  //                                       fail closed.
  //
  // Steady state: omit FPH_GRANDFATHER_UNTIL → all tokens must carry fph.
  const fingerprintEnabled = process.env.FINGERPRINT_BINDING !== "disabled";
  if (fingerprintEnabled) {
    if (!payload.fph) {
      const grandfatherUntil = Number(process.env.FPH_GRANDFATHER_UNTIL ?? 0);
      if (grandfatherUntil > 0 && payload.iat <= grandfatherUntil) {
        // Legacy token issued before A1 rollout — accept this run, will expire naturally.
        step("fingerprint", true, "grandfathered");
      } else {
        step("fingerprint", false, "fph-missing");
        return fail(E.AUTH_FINGERPRINT_REQUIRED, "invalid");
      }
    } else {
      const actualFph = fingerprintRequest(
        req.headers["user-agent"] as string | undefined,
        req.headers["accept-language"] as string | undefined,
      );
      if (payload.fph !== actualFph) {
        step("fingerprint", false);
        return fail(E.AUTH_FINGERPRINT, "invalid");
      }
      step("fingerprint", true);
    }
  } else {
    step("fingerprint", true, "disabled");
  }

  // 7. Role check (super_admin always passes — architectural invariant)
  const role = payload.role;
  if (allowedRoles && role !== "super_admin" && !allowedRoles.includes(role)) {
    step("role", false, `need:${allowedRoles.join("|")} got:${role}`);
    return fail(E.AUTH_FORBIDDEN, "invalid");
  }
  step("role", true);

  // 8. Tenancy: clinicId must be present and a positive integer.
  // Tokens minted before this check existed could carry a missing/zero clinicId
  // and silently land in clinic 1; that is the bug. Fail-closed and re-mint.
  const clinicId = payload.clinicId;
  if (typeof clinicId !== "number" || !Number.isInteger(clinicId) || clinicId <= 0) {
    step("tenancy", false, `clinicId:${String(clinicId)}`);
    return fail(E.AUTH_INVALID, "invalid");
  }
  step("tenancy", true);

  return pass(
    { userId: payload.userId, username: payload.username, role, clinicId },
    { sessionTtl: extractTokenTtl(rawToken) },
  );
}

// ─── HTTP boundary ──────────────────────────────────────────────────────────

export function sendDecision(
  res: Response,
  req: Request,
  d: Extract<Decision, { ok: false }>,
): void {
  logger.warn({
    msg: "auth_denial",
    request_id: req.id,
    code: d.error.code,
    state: d.state,
    trace: d.trace,
  });

  res.setHeader("X-Session-State", d.state);
  res.status(d.error.status).json({
    success: false,
    error_code: d.error.code,
    error_name: d.error.name,
    session_state: d.state,
    message: d.error.name,
    request_id: req.id,
    timestamp: new Date().toISOString(),
  });
}
