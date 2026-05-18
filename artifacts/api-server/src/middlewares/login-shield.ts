/**
 * login-shield.ts — Focused middleware for the login endpoint.
 *
 * Provides server-side WAF-equivalent protections as a defense-in-depth layer
 * against credential stuffing and automated attacks:
 *
 *  1. Rejects oversized request bodies (Content-Length > 4 KB) — login payloads
 *     should be tiny; anything larger is almost certainly an abuse attempt.
 *  2. Rejects missing/empty Content-Type — legitimate browsers always send it.
 *  3. In production, rejects empty User-Agent — all real browsers send one;
 *     empty UA is a scanner/script signal.
 *  4. Adds a tight IP-level rate limiter (20 req / 15 min) on top of the
 *     existing per-user+IP DB-backed limiter — catches credential stuffing
 *     across many usernames from the same IP.
 */
import type { Request, Response, NextFunction } from "express";
import { ipRateLimit } from "./rateLimiter";

/** Max allowed request body size for the login endpoint (4 KB). */
const MAX_LOGIN_BODY_BYTES = 4 * 1024;

/**
 * Aggressive IP-level rate limiter for the login endpoint.
 * 20 attempts per 15 minutes per IP — catches spray attacks across usernames.
 * Works alongside the per-user+IP DB-backed limiter in auth.service.ts.
 */
export const loginIpRateLimit = ipRateLimit(20, 15 * 60 * 1000);

/**
 * Request hygiene checks for the login endpoint.
 * Runs before body parsing completes — uses Content-Length header for size gate.
 */
export function loginShield(req: Request, res: Response, next: NextFunction): void {
  // 1. Content-Length size gate (deny before reading body)
  const contentLength = parseInt(req.headers["content-length"] ?? "0", 10);
  if (!isNaN(contentLength) && contentLength > MAX_LOGIN_BODY_BYTES) {
    res.status(413).json({ error: "Request too large" });
    return;
  }

  // 2. Content-Type must be application/json
  const ct = req.headers["content-type"] ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    res.status(415).json({ error: "Content-Type must be application/json" });
    return;
  }

  // 3. Empty User-Agent rejection in production
  //    Bots often send no UA; all browser + Postman clients include one.
  //    Disabled in dev/test to allow simple curl tests without UA.
  if (process.env.NODE_ENV === "production") {
    const ua = req.headers["user-agent"] ?? "";
    if (!ua.trim()) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
  }

  next();
}
