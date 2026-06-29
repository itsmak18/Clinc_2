// Phase 2 — Verification token issuance + consumption.
//
//  * Tokens are 32 random bytes (base64url), NOT a JWT. The raw token only
//    ever exists in the email body. The DB stores only `token_hash`
//    (SHA-256 of raw).
//  * 15-minute TTL.
//  * Atomic single-use consume via UPDATE ... WHERE consumed_at IS NULL
//    AND expires_at > now() RETURNING — a second click finds zero rows.
//  * fingerprint-bound: clicking from a different device fails closed,
//    defeating an attacker who intercepts the email.
//  * Debounced: if a non-consumed token for (user, fingerprint) exists from
//    the last 60s, reuse it instead of emailing twice (two-tabs case).

import crypto from "crypto";
// dbUnsafe: device_verification_tokens has no clinicId; consumed pre-auth
// before the user's clinic context is available.
import { dbUnsafe as db } from "@workspace/db";
import {
  deviceVerificationTokensTable,
  type DeviceVerificationToken,
} from "@workspace/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { config } from "../../lib/config";

const TOKEN_TTL_MS = 15 * 60 * 1000;
const DEBOUNCE_MS = 60 * 1000;

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function generateRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export interface CreateTokenInput {
  userId: number;
  pendingDeviceId: string;
  fingerprintHash: string;
}

export interface CreateTokenResult {
  id: number;
  rawToken: string;
  debounced: boolean;
}

/**
 * Issue a new verification token, or reuse a recent un-consumed one for the
 * same (userId, fingerprint) inside the debounce window. The raw token is
 * returned ONLY here — never persisted, never logged, never returned again.
 */
export async function createVerificationToken(
  inp: CreateTokenInput,
): Promise<CreateTokenResult> {
  const debounceCutoff = new Date(Date.now() - DEBOUNCE_MS);

  const [existing] = await db
    .select()
    .from(deviceVerificationTokensTable)
    .where(
      and(
        eq(deviceVerificationTokensTable.userId, inp.userId),
        eq(
          deviceVerificationTokensTable.fingerprintHash,
          inp.fingerprintHash,
        ),
        isNull(deviceVerificationTokensTable.consumedAt),
        gt(deviceVerificationTokensTable.createdAt, debounceCutoff),
        gt(deviceVerificationTokensTable.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (existing) {
    // We can't re-emit a raw token (we don't store it). Reuse the existing
    // verification row by issuing a fresh raw token bound to the same DB row
    // — UPDATE the hash + extend expiry. This is the debounce contract:
    // "don't email twice in 60s, but if you do, only one click works".
    const rawToken = generateRawToken();
    await db
      .update(deviceVerificationTokensTable)
      .set({
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
      })
      .where(eq(deviceVerificationTokensTable.id, existing.id));
    return { id: existing.id, rawToken, debounced: true };
  }

  const rawToken = generateRawToken();
  const [row] = await db
    .insert(deviceVerificationTokensTable)
    .values({
      userId: inp.userId,
      pendingDeviceId: inp.pendingDeviceId,
      tokenHash: hashToken(rawToken),
      fingerprintHash: inp.fingerprintHash,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    })
    .returning({ id: deviceVerificationTokensTable.id });

  return { id: row.id, rawToken, debounced: false };
}

export interface ConsumeTokenResult {
  ok: boolean;
  /** Populated on success; null when token was invalid/expired/already used. */
  token: DeviceVerificationToken | null;
  reason?: "invalid" | "expired_or_consumed" | "fingerprint_mismatch";
}

/** Look up a token by raw value without consuming. Returns userId + bound fp. */
export async function peekToken(
  rawToken: string,
): Promise<DeviceVerificationToken | null> {
  const tokenHash = hashToken(rawToken);
  const [row] = await db
    .select()
    .from(deviceVerificationTokensTable)
    .where(eq(deviceVerificationTokensTable.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

/**
 * Atomically consume a token. Fingerprint binding is enforced — the caller
 * must pass the fingerprint computed with the userId from `peekToken()` first.
 * Pass `bypassFingerprint: true` only on the "wasn't me" path where the rightful
 * owner is expected to click from a totally different device.
 */
export async function consumeVerificationToken(args: {
  rawToken: string;
  currentFingerprintHash: string;
  bypassFingerprint?: boolean;
}): Promise<ConsumeTokenResult> {
  const tokenHash = hashToken(args.rawToken);

  // Atomic consume: only one caller wins the UPDATE.
  const updated = await db
    .update(deviceVerificationTokensTable)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(deviceVerificationTokensTable.tokenHash, tokenHash),
        isNull(deviceVerificationTokensTable.consumedAt),
        gt(deviceVerificationTokensTable.expiresAt, sql`now()`),
      ),
    )
    .returning();

  if (updated.length === 0) {
    return { ok: false, token: null, reason: "expired_or_consumed" };
  }

  const token = updated[0];
  if (!args.bypassFingerprint && token.fingerprintHash !== args.currentFingerprintHash) {
    // The token was consumed by the wrong device — leave it consumed (one-shot
    // is preserved) but reject the action. An attacker on a different device
    // who intercepts the link burns the token without gaining access.
    return { ok: false, token, reason: "fingerprint_mismatch" };
  }

  return { ok: true, token };
}

/**
 * Build the public verification URL. The frontend route is /verify-device,
 * which posts the token back to /api/auth/verify-device.
 */
export function buildVerificationLink(rawToken: string): string {
  const base =
    config.appPublicUrl ??
    "http://localhost:5173";
  const origin = base.startsWith("http") ? base : `https://${base}`;
  return `${origin}/verify-device?t=${encodeURIComponent(rawToken)}`;
}
