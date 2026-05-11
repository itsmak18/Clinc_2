/**
 * csrf.ts
 *
 * CSRF protection using the double-submit cookie pattern.
 *
 * Defense-in-depth strategy:
 *   - Primary:   SameSite=Strict on clinic_token cookie (already in place)
 *   - Secondary: Double-submit cookie (this middleware)
 *
 * How it works:
 *   1. On login, the server sets a `_csrf` cookie (NOT HttpOnly — JS reads it).
 *   2. The frontend reads `_csrf` and sends it as `X-CSRF-Token` header on mutations.
 *   3. This middleware compares cookie value === header value using constant-time comparison.
 *   4. Attacker running cross-site cannot read `_csrf` cookie (same-origin policy),
 *      so they can't forge the matching header.
 *
 * Safe methods (GET, HEAD, OPTIONS) are skipped — they must not mutate state.
 * The /auth/login endpoint is excluded (no session exists yet).
 */
import { randomBytes, timingSafeEqual } from "crypto";
import type { Request, Response, NextFunction } from "express";

const CSRF_COOKIE_NAME = "_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Endpoints that are excluded from CSRF checks (pre-auth)
const CSRF_EXEMPT_PATHS = new Set(["/api/auth/login"]);

/**
 * Generate a CSRF token and set it as a readable (non-HttpOnly) cookie.
 * Call this inside the login route after authentication succeeds.
 */
export function setCsrfCookie(res: Response): string {
  const token = randomBytes(32).toString("hex");
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false,  // MUST be readable by JavaScript
    secure: isProduction,
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000, // Match auth token lifetime
    path: "/",
  });
  return token;
}

/**
 * Clear the CSRF cookie on logout.
 */
export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}

/**
 * Express middleware: validate CSRF token on all mutation methods.
 * Mount this AFTER cookieParser and BEFORE route handlers.
 */
export function csrfProtect(req: Request, res: Response, next: NextFunction): void {
  // Skip safe HTTP methods
  if (SAFE_METHODS.has(req.method.toUpperCase())) {
    next();
    return;
  }

  // Skip exempt paths (login — token doesn't exist yet)
  if (CSRF_EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }

  const cookieToken: string | undefined = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken: string | undefined = req.headers[CSRF_HEADER_NAME] as string | undefined;

  if (!cookieToken || !headerToken) {
    res.status(403).json({
      error: "CSRF token missing",
      hint: "Include X-CSRF-Token header with the value from the _csrf cookie.",
    });
    return;
  }

  // Constant-time comparison to prevent timing attacks
  try {
    const a = Buffer.from(cookieToken, "utf8");
    const b = Buffer.from(headerToken, "utf8");
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(403).json({ error: "CSRF token mismatch" });
      return;
    }
  } catch {
    res.status(403).json({ error: "CSRF token invalid" });
    return;
  }

  next();
}
