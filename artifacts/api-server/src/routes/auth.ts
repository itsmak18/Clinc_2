import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, auditLogsTable } from "@workspace/db";
import { eq, isNull, and } from "drizzle-orm";
import { signToken } from "../lib/auth";
import { verifyPassword, hashPassword, isLegacyHash, validatePasswordStrength } from "../lib/password";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { checkAllowed, recordFailure, recordSuccess, getRemainingAttempts } from "../middlewares/rateLimiter";

const router = Router();

// ── Helper: write an audit log entry directly (no req.user needed for login events)
async function logLoginEvent(
  req: AuthRequest,
  action: "LOGIN_SUCCESS" | "LOGIN_FAILED" | "LOGIN_LOCKED",
  userId?: number,
  details?: object,
) {
  try {
    await db.insert(auditLogsTable).values({
      userId: userId ?? null,
      action,
      entityType: "session",
      entityId: userId ?? null,
      ipAddress: req.ip || req.socket?.remoteAddress || "unknown",
      details: details ?? null,
    });
  } catch { /* audit failure must never break auth */ }
}

router.post("/auth/login", async (req: AuthRequest, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  // Rate-limit key: combine username + IP so both vectors are blocked
  const ip = req.ip || "unknown";
  const keyByIp       = `ip:${ip}`;
  const keyByUsername = `user:${username}`;

  const [ipCheck, userCheck] = await Promise.all([
    checkAllowed(keyByIp),
    checkAllowed(keyByUsername),
  ]);

  if (!ipCheck.allowed || !userCheck.allowed) {
    const retryAfter = Math.max(ipCheck.retryAfterSecs ?? 0, userCheck.retryAfterSecs ?? 0);
    await logLoginEvent(req, "LOGIN_LOCKED", undefined, { username, ip, retryAfterSecs: retryAfter });
    res.status(429).json({
      error: `Account temporarily locked due to too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes.`,
      retryAfterSecs: retryAfter,
    });
    return;
  }

  // Find user — must be active AND not soft-deleted
  const [user] = await db.select().from(usersTable).where(
    and(eq(usersTable.username, username), isNull(usersTable.deletedAt))
  );

  if (!user || !user.isActive) {
    await Promise.all([recordFailure(keyByIp), recordFailure(keyByUsername)]);
    const [remIp, remUser] = await Promise.all([getRemainingAttempts(keyByIp), getRemainingAttempts(keyByUsername)]);
    const remaining = Math.min(remIp, remUser);
    await logLoginEvent(req, "LOGIN_FAILED", user?.id, { username, ip, attemptsRemaining: remaining });
    res.status(401).json({
      error: "Invalid credentials",
      attemptsRemaining: remaining > 0 ? remaining : undefined,
    });
    return;
  }

  // Verify password (supports both bcrypt and legacy HMAC)
  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    await Promise.all([recordFailure(keyByIp), recordFailure(keyByUsername)]);
    const [remIp, remUser] = await Promise.all([getRemainingAttempts(keyByIp), getRemainingAttempts(keyByUsername)]);
    const remaining = Math.min(remIp, remUser);
    await logLoginEvent(req, "LOGIN_FAILED", user.id, { username, ip, attemptsRemaining: remaining });
    res.status(401).json({
      error: "Invalid credentials",
      attemptsRemaining: remaining > 0 ? remaining : undefined,
    });
    return;
  }

  // Auto-migrate legacy HMAC hashes to bcrypt on successful login
  if (isLegacyHash(user.passwordHash)) {
    const newHash = await hashPassword(password);
    await db.update(usersTable)
      .set({ passwordHash: newHash, updatedAt: new Date() })
      .where(eq(usersTable.id, user.id));
  }

  // Credentials valid — clear lockout counters and issue token
  await Promise.all([recordSuccess(keyByIp), recordSuccess(keyByUsername)]);

  const token = signToken({ userId: user.id, username: user.username, role: user.role });
  await logLoginEvent(req, "LOGIN_SUCCESS", user.id, { ip, role: user.role });

  const isProduction = process.env.NODE_ENV === "production";

  res.cookie("clinic_token", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/",
  });

  res.json({
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      fullNameAr: user.fullNameAr,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    },
  });
});

router.post("/auth/logout", requireAuth, async (req: AuthRequest, res) => {
  try {
    await db.insert(auditLogsTable).values({
      userId: req.user!.userId,
      action: "LOGOUT",
      entityType: "session",
      entityId: req.user!.userId,
      ipAddress: req.ip || "unknown",
      details: null,
    });
  } catch { /* non-blocking */ }

  res.clearCookie("clinic_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });

  res.json({ success: true });
});

router.get("/auth/me", requireAuth, async (req: AuthRequest, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    fullNameAr: user.fullNameAr,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
  });
});

// ── Self-service password change ────────────────────────────────────────────
router.post("/auth/change-password", requireAuth, async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current password and new password are required" });
    return;
  }

  const strength = validatePasswordStrength(newPassword);
  if (!strength.valid) {
    res.status(400).json({ error: strength.reason });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.userId));
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  const newHash = await hashPassword(newPassword);
  await db.update(usersTable)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(usersTable.id, req.user!.userId));

  try {
    await db.insert(auditLogsTable).values({
      userId: req.user!.userId,
      action: "CHANGE_PASSWORD",
      entityType: "user",
      entityId: req.user!.userId,
      ipAddress: req.ip || "unknown",
      details: null,
    });
  } catch { /* non-blocking */ }

  res.json({ success: true });
});

export default router;
