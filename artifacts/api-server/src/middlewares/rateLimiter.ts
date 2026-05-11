import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { loginAttemptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const WINDOW_MS    = 15 * 60 * 1000;  // 15-minute sliding window
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS   = 30 * 60 * 1000;  // 30-minute lockout

export async function checkAllowed(
  key: string,
): Promise<{ allowed: boolean; retryAfterSecs?: number }> {
  const now = new Date();
  const [row] = await db.select().from(loginAttemptsTable).where(eq(loginAttemptsTable.key, key));

  if (!row) return { allowed: true };

  // Active lockout
  if (row.lockedUntil && row.lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSecs: Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000),
    };
  }

  // Stale lockout or expired window — delete and allow
  if (
    (row.lockedUntil && row.lockedUntil <= now) ||
    now.getTime() - row.firstSeen.getTime() > WINDOW_MS
  ) {
    await db.delete(loginAttemptsTable).where(eq(loginAttemptsTable.key, key));
    return { allowed: true };
  }

  return { allowed: true };
}

export async function recordFailure(key: string): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const lockoutUntil = new Date(now.getTime() + LOCKOUT_MS);

  // Single atomic upsert — avoids read-then-write race condition
  await db.execute(sql`
    INSERT INTO login_attempts (key, count, first_seen, locked_until, updated_at)
    VALUES (${key}, 1, ${now}, NULL, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN login_attempts.first_seen < ${windowStart} THEN 1
        ELSE login_attempts.count + 1
      END,
      first_seen = CASE
        WHEN login_attempts.first_seen < ${windowStart} THEN ${now}
        ELSE login_attempts.first_seen
      END,
      locked_until = CASE
        WHEN (CASE
          WHEN login_attempts.first_seen < ${windowStart} THEN 1
          ELSE login_attempts.count + 1
        END) >= ${MAX_ATTEMPTS}
        THEN ${lockoutUntil}
        ELSE NULL
      END,
      updated_at = ${now}
  `);
}

export async function recordSuccess(key: string): Promise<void> {
  await db.delete(loginAttemptsTable).where(eq(loginAttemptsTable.key, key));
}

export async function getRemainingAttempts(key: string): Promise<number> {
  const [row] = await db.select().from(loginAttemptsTable).where(eq(loginAttemptsTable.key, key));
  if (!row) return MAX_ATTEMPTS;
  return Math.max(0, MAX_ATTEMPTS - row.count);
}

/**
 * General-purpose IP rate limiter middleware for non-login endpoints.
 * Stays in-memory intentionally — restart persistence is not a security
 * requirement for these endpoints.
 */
export function ipRateLimit(maxPerWindow: number, windowMs: number) {
  const ipStore = new Map<string, { count: number; firstSeen: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || "unknown";
    const now = Date.now();
    const b = ipStore.get(ip);
    if (!b || now - b.firstSeen > windowMs) {
      ipStore.set(ip, { count: 1, firstSeen: now });
      return next();
    }
    if (b.count >= maxPerWindow) {
      res.status(429).json({ error: "Too many requests. Please try again later." });
      return;
    }
    b.count++;
    next();
  };
}
