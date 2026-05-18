import { db } from "@workspace/db";
import { usersTable, auditLogsTable } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { signToken, revokeAllTokensForUser } from "../lib/auth";
import { verifyPassword, hashPassword, isLegacyHash, validatePasswordStrength } from "../lib/password";
import { checkAllowed, recordFailure, recordSuccess, getRemainingAttempts } from "../middlewares/rateLimiter";
import { NotFoundError, UnauthorizedError, ValidationError } from "./errors";

// Audit helpers that don't need req — accept primitives instead
async function logLoginAudit(
  action: "LOGIN_SUCCESS" | "LOGIN_FAILED" | "LOGIN_LOCKED",
  ip: string,
  userId?: number,
  details?: object,
) {
  try {
    await db.insert(auditLogsTable).values({
      userId: userId ?? null,
      action,
      entityType: "session",
      entityId: userId ?? null,
      ipAddress: ip,
      details: details ?? null,
    });
  } catch { /* audit failure must never break auth */ }
}

export interface LoginContext {
  ip: string;
  userAgent?: string;
  acceptLanguage?: string;
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

export interface LoginResult {
  token: string;
  user: AuthUser;
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

  const token = await signToken(
    { userId: user.id, username: user.username, role: user.role },
    { "user-agent": userAgent, "accept-language": acceptLanguage },
  );
  await logLoginAudit("LOGIN_SUCCESS", ip, user.id, { role: user.role });

  return {
    token,
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
      entityId: userId,
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
  const strength = validatePasswordStrength(newPassword);
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
      entityId: userId,
      ipAddress: ip,
      details: null,
    });
  } catch { /* non-blocking */ }
}
