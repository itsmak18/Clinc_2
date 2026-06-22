// dbUnsafe: auth runs before a user context exists (login, rate-limit, legacy
// hash migration), so usersTable is read without a tenant context. audit_logs
// inserts here set clinicId explicitly (SYSTEM_CLINIC_ID for pre-tenant session
// events; the real clinicId where the user record is resolved).
import { dbUnsafe as db } from "@workspace/db";
import { usersTable, auditLogsTable, clinicsTable } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { signToken, revokeAllTokensForUser } from "../lib/auth";
import { verifyPassword, hashPassword, isLegacyHash, validatePasswordStrictAsync } from "../lib/password";
import { checkAllowed, recordFailure, recordSuccess, getRemainingAttempts } from "../middlewares/rateLimiter";
import { NotFoundError, UnauthorizedError, ValidationError } from "./errors";
import { evaluateDeviceTrust } from "./device-trust.service";
import { SYSTEM_CLINIC_ID } from "../lib/audit";

// Audit helpers that don't need req — accept primitives instead
async function logLoginAudit(
  action: "LOGIN_SUCCESS" | "LOGIN_FAILED" | "LOGIN_LOCKED" | "LOGIN_PENDING_VERIFICATION",
  ip: string,
  userId?: number,
  details?: object,
  // Resolved-user events (LOGIN_SUCCESS / PENDING) pass the user's real clinicId
  // so they land in that clinic's audit view. Failed/locked logins have no user
  // resolved, so they keep SYSTEM_CLINIC_ID (the schema default is gone).
  clinicId: number = SYSTEM_CLINIC_ID,
) {
  try {
    await db.insert(auditLogsTable).values({
      clinicId,
      userId: userId ?? null,
      action,
      entityType: "session",
      entityId: userId != null ? String(userId) : null,
      ipAddress: ip,
      details: details ?? null,
    });
  } catch { /* audit failure must never break auth */ }
}

export interface LoginContext {
  ip: string;
  userAgent?: string;
  acceptLanguage?: string;
  /** Phase 2 — device cookie value if the browser already had one. */
  deviceIdCookie?: string;
  /** Phase 2 — optional Sec-CH-UA-Platform header. */
  platform?: string;
  /** Phase 2 — optional client-supplied hints (screen + tz). */
  clientHints?: string;
}

export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  fullNameAr: string | null;
  email: string | null;
  role: string;
  isActive: boolean;
}

/**
 * Successful login. `deviceUnverified=true` means the session was issued with
 * `dvu` claim — capability-gated routes will refuse PHI bulk reads/exports.
 * `deviceId` is the value the caller should write into the __Host- cookie.
 */
export interface LoginSuccess {
  outcome: "success";
  token: string;
  user: AuthUser;
  deviceId: string;
  deviceUnverified: boolean;
}

/**
 * Blocked because this is a new device on a privileged role. No session is
 * issued; the user must click the email link first. The route layer maps
 * this to a 202-style `pending_verification` response.
 */
export interface LoginPending {
  outcome: "pending_verification";
  deviceId: string;
  /** Generic message the FE shows verbatim. Identical for unknown accounts
   *  so we don't leak existence. */
  message: string;
}

export type LoginResult = LoginSuccess | LoginPending;

// F-3: equalize login latency so a missing/inactive account can't be enumerated
// by timing (the no-user path otherwise skips the ~100ms bcrypt verify). Lazily
// compute one real bcrypt hash (same cost factor as stored hashes) and compare
// the supplied password against it on the no-user branch. Cached after first use.
let dummyHashPromise: Promise<string> | null = null;
function timingEqualizerHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = hashPassword("login-timing-equalizer-not-a-real-password");
  return dummyHashPromise;
}

export async function loginUser(
  username: string,
  password: string,
  ctx: LoginContext,
): Promise<LoginResult> {
  const { ip, userAgent, acceptLanguage } = ctx;
  const keyByIp       = `ip:${ip}`;
  const keyByUsername = `user:${username}`;

  const [ipCheck, userCheck] = await Promise.all([
    checkAllowed(keyByIp),
    checkAllowed(keyByUsername),
  ]);

  if (!ipCheck.allowed || !userCheck.allowed) {
    const retryAfter = Math.max(ipCheck.retryAfterSecs ?? 0, userCheck.retryAfterSecs ?? 0);
    await logLoginAudit("LOGIN_LOCKED", ip, undefined, { username, retryAfterSecs: retryAfter });
    throw Object.assign(
      new Error(`Account temporarily locked. Try again in ${Math.ceil(retryAfter / 60)} minutes.`),
      { status: 429, retryAfterSecs: retryAfter },
    );
  }

  const [user] = await db.select().from(usersTable).where(
    and(eq(usersTable.username, username), isNull(usersTable.deletedAt)),
  );

  if (!user || !user.isActive) {
    // Spend the same bcrypt time as a real verify so latency doesn't reveal
    // whether the account exists / is active (F-3).
    await verifyPassword(password, await timingEqualizerHash());
    await Promise.all([recordFailure(keyByIp), recordFailure(keyByUsername)]);
    const [remIp, remUser] = await Promise.all([getRemainingAttempts(keyByIp), getRemainingAttempts(keyByUsername)]);
    const remaining = Math.min(remIp, remUser);
    await logLoginAudit("LOGIN_FAILED", ip, user?.id, { username, attemptsRemaining: remaining });
    throw Object.assign(
      new UnauthorizedError("Invalid credentials"),
      { attemptsRemaining: remaining > 0 ? remaining : undefined },
    );
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    await Promise.all([recordFailure(keyByIp), recordFailure(keyByUsername)]);
    const [remIp, remUser] = await Promise.all([getRemainingAttempts(keyByIp), getRemainingAttempts(keyByUsername)]);
    const remaining = Math.min(remIp, remUser);
    await logLoginAudit("LOGIN_FAILED", ip, user.id, { username, attemptsRemaining: remaining });
    throw Object.assign(
      new UnauthorizedError("Invalid credentials"),
      { attemptsRemaining: remaining > 0 ? remaining : undefined },
    );
  }

  // Auto-migrate legacy HMAC hashes to bcrypt on successful login
  if (isLegacyHash(user.passwordHash)) {
    const newHash = await hashPassword(password);
    await db.update(usersTable)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));
  }

  await Promise.all([recordSuccess(keyByIp), recordSuccess(keyByUsername)]);

  // Phase 2 — device trust dispatch. When the master flag is OFF this always
  // returns { kind: "trusted" } with no DB writes and no emails.
  const trust = await evaluateDeviceTrust({
    userId: user.id,
    username: user.username,
    role: user.role,
    email: user.email,
    userAgent,
    platform: ctx.platform,
    clientHints: ctx.clientHints,
    ipAddress: ip,
    deviceIdCookie: ctx.deviceIdCookie,
  });

  if (trust.kind === "blocked") {
    await logLoginAudit("LOGIN_PENDING_VERIFICATION", ip, user.id, {
      role: user.role,
      reason: "new_device_privileged_role",
    }, user.clinicId);
    return {
      outcome: "pending_verification",
      deviceId: trust.deviceId,
      message: "Check your email for a verification link to complete sign-in.",
    };
  }

  const deviceUnverified = trust.kind === "allow_unverified";

  // Per-clinic timezone is minted into the JWT so date math uses the clinic's
  // business day, not the env CLINIC_TZ fallback. clinics.timezone is NOT NULL
  // (default Europe/Istanbul); the conditional is belt-and-braces for a missing row.
  const [clinic] = await db
    .select({ timezone: clinicsTable.timezone })
    .from(clinicsTable)
    .where(eq(clinicsTable.id, user.clinicId));

  const token = await signToken(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
      clinicId: user.clinicId,
      ...(clinic?.timezone ? { timezone: clinic.timezone } : {}),
      ...(deviceUnverified ? { dvu: true } : {}),
    },
    { "user-agent": userAgent, "accept-language": acceptLanguage },
  );
  await logLoginAudit("LOGIN_SUCCESS", ip, user.id, {
    role: user.role,
    deviceUnverified,
  }, user.clinicId);

  return {
    outcome: "success",
    token,
    deviceId: trust.deviceId,
    deviceUnverified,
    user: {
      id: user.id, username: user.username, fullName: user.fullName,
      fullNameAr: user.fullNameAr, email: user.email, role: user.role, isActive: user.isActive,
    },
  };
}

export async function logoutUser(userId: number, ip: string, clinicId: number = SYSTEM_CLINIC_ID): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
      clinicId, // the caller threads req.user.clinicId; falls back to SYSTEM for any user-less caller
      userId,
      action: "LOGOUT",
      entityType: "session",
      entityId: String(userId),
      ipAddress: ip,
      details: null,
    });
  } catch { /* non-blocking */ }

  await revokeAllTokensForUser(userId);
}

export async function getMe(userId: number) {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new NotFoundError("user", userId);
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    fullNameAr: user.fullNameAr,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  };
}

export async function changePassword(
  userId: number,
  currentPassword: string,
  newPassword: string,
  ip: string,
): Promise<void> {
  const strength = await validatePasswordStrictAsync(newPassword);
  if (!strength.valid) throw new ValidationError(strength.reason ?? "Password does not meet requirements");

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user) throw new NotFoundError("user", userId);

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) throw new UnauthorizedError("Current password is incorrect");

  const newHash = await hashPassword(newPassword);
  await db.update(usersTable)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(usersTable.id, userId));

  try {
    await db.insert(auditLogsTable).values({
      clinicId: user.clinicId, // real clinic — the user record is resolved above
      userId,
      action: "CHANGE_PASSWORD",
      entityType: "user",
      entityId: String(userId),
      ipAddress: ip,
      details: null,
    });
  } catch { /* non-blocking */ }
}
