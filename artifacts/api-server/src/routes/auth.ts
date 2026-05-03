import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable, auditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { signToken, verifyPassword } from "../lib/auth";
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

  const ipCheck   = checkAllowed(keyByIp);
  const userCheck = checkAllowed(keyByUsername);

  if (!ipCheck.allowed || !userCheck.allowed) {
    const retryAfter = Math.max(ipCheck.retryAfterSecs ?? 0, userCheck.retryAfterSecs ?? 0);
    await logLoginEvent(req, "LOGIN_LOCKED", undefined, { username, ip, retryAfterSecs: retryAfter });
    res.status(429).json({
      error: `Account temporarily locked due to too many failed attempts. Try again in ${Math.ceil(retryAfter / 60)} minutes.`,
      retryAfterSecs: retryAfter,
    });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));

  if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
    recordFailure(keyByIp);
    recordFailure(keyByUsername);
    const remaining = Math.min(getRemainingAttempts(keyByIp), getRemainingAttempts(keyByUsername));
    await logLoginEvent(req, "LOGIN_FAILED", user?.id, { username, ip, attemptsRemaining: remaining });

    // Generic message — do not leak whether username exists
    res.status(401).json({
      error: "Invalid credentials",
      attemptsRemaining: remaining > 0 ? remaining : undefined,
    });
    return;
  }

  // Credentials valid — clear lockout counters and issue token
  recordSuccess(keyByIp);
  recordSuccess(keyByUsername);

  const token = signToken({ userId: user.id, username: user.username, role: user.role });
  await logLoginEvent(req, "LOGIN_SUCCESS", user.id, { ip, role: user.role });

  res.json({
    token,
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
  // Log the logout for the audit trail
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

export default router;
