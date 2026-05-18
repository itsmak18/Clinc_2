import { randomBytes } from "crypto";
import type { Response } from "express";

const CSRF_COOKIE_NAME = "_csrf";

/**
 * Generate a CSRF token and set it as a readable (non-HttpOnly) cookie.
 * Call this on login (and on GET /api/csrf for SPA bootstrap).
 * The frontend reads `_csrf` and sends it as `X-CSRF-Token` header on mutations.
 */
export function setCsrfCookie(res: Response): string {
  const token = randomBytes(24).toString("hex");
  const isProduction = process.env.NODE_ENV === "production";
  res.cookie(CSRF_COOKIE_NAME, token, {
    httpOnly: false, // MUST be readable by JavaScript
    secure: isProduction,
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  });
  return token;
}

export function clearCsrfCookie(res: Response): void {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
}
