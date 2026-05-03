import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  firstSeen: number;
  lockedUntil?: number;
}

const store = new Map<string, Bucket>();

const WINDOW_MS = 15 * 60 * 1000;  // 15 min sliding window
const MAX_ATTEMPTS = 5;             // attempts before lockout
const LOCKOUT_MS  = 30 * 60 * 1000; // 30 min lockout

// Periodic cleanup to avoid memory growth
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of store) {
    const expired = bucket.lockedUntil
      ? now > bucket.lockedUntil + LOCKOUT_MS
      : now - bucket.firstSeen > WINDOW_MS;
    if (expired) store.delete(key);
  }
}, 10 * 60 * 1000);

export function checkAllowed(key: string): { allowed: boolean; retryAfterSecs?: number } {
  const now = Date.now();
  const b = store.get(key);
  if (!b) return { allowed: true };

  if (b.lockedUntil) {
    if (now < b.lockedUntil) {
      return { allowed: false, retryAfterSecs: Math.ceil((b.lockedUntil - now) / 1000) };
    }
    store.delete(key);
    return { allowed: true };
  }

  if (now - b.firstSeen > WINDOW_MS) {
    store.delete(key);
    return { allowed: true };
  }

  return { allowed: true };
}

export function recordFailure(key: string): void {
  const now = Date.now();
  const b = store.get(key);
  if (!b || now - b.firstSeen > WINDOW_MS) {
    store.set(key, { count: 1, firstSeen: now });
    return;
  }
  const count = b.count + 1;
  store.set(key, {
    count,
    firstSeen: b.firstSeen,
    lockedUntil: count >= MAX_ATTEMPTS ? now + LOCKOUT_MS : undefined,
  });
}

export function recordSuccess(key: string): void {
  store.delete(key);
}

export function getRemainingAttempts(key: string): number {
  const b = store.get(key);
  if (!b) return MAX_ATTEMPTS;
  return Math.max(0, MAX_ATTEMPTS - b.count);
}

/** General-purpose rate limiter middleware (IP-based, for any endpoint). */
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
