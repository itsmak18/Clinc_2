// Device identity helpers. Two distinct values:
//
//   device_id        — UUID stored in the `__Host-device_id` cookie. Survives
//                      browser sessions. 1 year TTL. Primary key on lookup.
//   fingerprint_hash — HMAC(serverSecret, userId || UA-family || screen || tz).
//                      Used as a fallback match when the cookie is cleared.
//                      Salted by user_id so leaked rows cannot correlate the
//                      same browser across users.
//
// Explicitly NOT in the fingerprint: ASN, IP, country — those flip on every
// cellular handoff and would force "new device" emails forever. They are
// stored on `user_devices` as risk signals only.

import crypto from "crypto";
import type { Request, Response } from "express";
import { JWT_SECRET } from "./jwt-secret";

export const DEVICE_COOKIE_NAME = "__Host-device_id";
export const DEVICE_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/** UA family (Chrome / Firefox / Safari / Edge / Other) — ignores version. */
function uaFamily(ua: string | undefined): string {
  if (!ua) return "Unknown";
  if (/Edg\//.test(ua)) return "Edge";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "Safari";
  return "Other";
}

export interface FingerprintInputs {
  userId: number;
  userAgent: string | undefined;
  /** Free-form client hint header (e.g. Sec-CH-UA-Platform). */
  platform?: string;
  /** Optional client-supplied screen + tz string ("1920x1080:Asia/Riyadh"). */
  clientHints?: string;
}

export function computeFingerprint(inp: FingerprintInputs): string {
  const family = uaFamily(inp.userAgent);
  const material = [
    String(inp.userId),
    family,
    inp.platform ?? "",
    inp.clientHints ?? "",
  ].join("|");

  // HMAC-SHA256, keyed by the server secret so DB rows on their own cannot be
  // correlated across users — a per-user salt is baked into `material`.
  return crypto
    .createHmac("sha256", Buffer.from(JWT_SECRET))
    .update(material)
    .digest("hex");
}

/** Read the device cookie if present and well-formed. */
export function readDeviceCookie(req: Request): string | undefined {
  const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[
    DEVICE_COOKIE_NAME
  ];
  if (!raw) return undefined;
  return /^[0-9a-f-]{36}$/i.test(raw) ? raw : undefined;
}

/** Issue (or refresh) the device cookie. */
export function setDeviceCookie(res: Response, deviceId: string): void {
  res.cookie(DEVICE_COOKIE_NAME, deviceId, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE_MS,
  });
}

export function clearDeviceCookie(res: Response): void {
  res.clearCookie(DEVICE_COOKIE_NAME, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
  });
}

export function newDeviceId(): string {
  return crypto.randomUUID();
}
