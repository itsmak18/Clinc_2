// dbUnsafe: auth runs before a user context exists (login, rate-limit, legacy
// hash migration). usersTable and auditLogsTable are queried without a clinic
// context because the authenticating user's clinicId is not yet known.
import { dbUnsafe as db } from "@workspace/db";
import { usersTable, auditLogsTable } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { signToken, revokeAllTokensForUser } from "../lib/auth";
import { verifyPassword, hashPassword, isLegacyHash, validatePasswordStrictAsync } from "../lib/password";
import { checkAllowed, recordFailure, recordSuccess, getRemainingAttempts } from "../middlewares/rateLimiter";
import { NotFoundError, UnauthorizedError, ValidationError } from "./errors";
import { evaluateDeviceTrust } from "./device-trust.service";

// Audit helpers that don't need req — accept primitives instead
async function logLoginAudit(
  action: "LOGIN_SUCCESS" | "LOGIN_FAILED" | "LOGIN_LOCKED" | "LOGIN_PENDING_VERIFICATION",
  ip: string,
  userId?: number,
  details?: object,
) {
  try {
    await db.insert(auditLogsTable).values({
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
    });
    return {
      outcome: "pending_verification",
      deviceId: trust.deviceId,
      message: "Check your email for a verification link to complete sign-in.",
    };
  }

  const deviceUnverified = trust.kind === "allow_unverified";

  const token = await signToken(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
      clinicId: user.clinicId,
      ...(deviceUnverified ? { dvu: true } : {}),
    },
    { "user-agent": userAgent, "accept-language": acceptLanguage },
  );
  await logLoginAudit("LOGIN_SUCCESS", ip, user.id, {
    role: user.role,
    deviceUnverified,
  });

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

export async function logoutUser(userId: number, ip: string): Promise<void> {
  try {
    await db.insert(auditLogsTable).values({
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
      userId,
      action: "CHANGE_PASSWORD",
      entityType: "user",
      entityId: String(userId),
      ipAddress: ip,
      details: null,
    });
  } catch { /* non-blocking */ }
}
