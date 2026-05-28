// Phase 2 — password-reset token issuance + consumption.
//
//   issueSelfServiceReset(username) — anonymous endpoint, byte-identical
//     response whether the account exists or not (no enumeration oracle).
//   issueAdminReset(userId) — privileged endpoint, returns the raw token to
//     the admin (compliance officer / super_admin) for out-of-band delivery.
//   consumePasswordReset({ rawToken, newPassword }) — atomic single-use.

import crypto from "crypto";
import { db } from "@workspace/db";
import {
  usersTable,
  passwordResetTokensTable,
  type PasswordResetToken,
} from "@workspace/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { hashPassword, validatePasswordStrictAsync } from "../lib/password";
import { sendEmail } from "./email.service";
import { revokeAllTokensForUser } from "../lib/auth";

const RESET_TTL_MS = 30 * 60 * 1000;

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function generateRawToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function buildResetLink(rawToken: string): string {
  const base =
    process.env.APP_PUBLIC_URL ??
    process.env.REPLIT_DOMAINS?.split(",")[0] ??
    "http://localhost:5173";
  const origin = base.startsWith("http") ? base : `https://${base}`;
  return `${origin}/reset-password?t=${encodeURIComponent(rawToken)}`;
}

/** Caller MUST use this generic response shape regardless of outcome. */
export const SELF_SERVICE_RESPONSE = {
  status: "pending_verification" as const,
  message:
    "If an account with that username exists, a reset link has been sent to the linked email.",
};

export async function issueSelfServiceReset(username: string): Promise<void> {
  // Find the user, but never reveal existence to the caller.
  const [user] = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      isActive: usersTable.isActive,
      fullName: usersTable.fullName,
    })
    .from(usersTable)
    .where(
      and(eq(usersTable.username, username), isNull(usersTable.deletedAt)),
    )
    .limit(1);

  if (!user || !user.isActive || !user.email) return;

  const rawToken = generateRawToken();
  await db.insert(passwordResetTokensTable).values({
    userId: user.id,
    tokenHash: hashToken(rawToken),
    source: "self_service",
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });

  await sendEmail({
    to: user.email,
    subject: "MediCore — reset your password",
    text:
      `Hi ${user.fullName},\n\n` +
      `Someone (hopefully you) requested a password reset for your MediCore account.\n` +
      `Click the link below within 30 minutes to choose a new password:\n\n${buildResetLink(rawToken)}\n\n` +
      `If you did NOT request this, ignore this email — your password will remain unchanged.`,
    tag: "password_reset",
  });
}

/**
 * Admin-issued reset. Returns the raw token so the admin can deliver it
 * out-of-band (verbal handoff, secure chat). The token is single-use and
 * 30-min TTL like the self-service path.
 */
export async function issueAdminReset(
  targetUserId: number,
): Promise<{ rawToken: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  const rawToken = generateRawToken();
  await db.insert(passwordResetTokensTable).values({
    userId: targetUserId,
    tokenHash: hashToken(rawToken),
    source: "admin_reset",
    expiresAt,
  });
  return { rawToken, expiresAt };
}

export interface ConsumeResetResult {
  ok: boolean;
  token: PasswordResetToken | null;
  reason?: "invalid" | "expired_or_consumed" | "weak_password";
  passwordReason?: string;
}

export async function consumePasswordReset(args: {
  rawToken: string;
  newPassword: string;
}): Promise<ConsumeResetResult> {
  const tokenHash = hashToken(args.rawToken);

  const policy = await validatePasswordStrictAsync(args.newPassword);
  if (!policy.valid) {
    return {
      ok: false,
      token: null,
      reason: "weak_password",
      passwordReason: policy.reason,
    };
  }

  const updated = await db
    .update(passwordResetTokensTable)
    .set({ consumedAt: new Date() })
    .where(
      and(
        eq(passwordResetTokensTable.tokenHash, tokenHash),
        isNull(passwordResetTokensTable.consumedAt),
        gt(passwordResetTokensTable.expiresAt, sql`now()`),
      ),
    )
    .returning();

  if (updated.length === 0) {
    return { ok: false, token: null, reason: "expired_or_consumed" };
  }
  const token = updated[0];

  const newHash = await hashPassword(args.newPassword);
  await db
    .update(usersTable)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(usersTable.id, token.userId));

  // Kill all existing sessions so a hijacker who already has one is logged out.
  await revokeAllTokensForUser(token.userId);

  return { ok: true, token };
}
