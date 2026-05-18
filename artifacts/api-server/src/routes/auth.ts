import { Router } from "express";
import { z } from "zod/v4";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { authGate } from "../middlewares/auth-gate";
import { asyncHandler } from "../middlewares/asyncHandler";
import { setCsrfCookie, clearCsrfCookie } from "../lib/csrf-cookie";
import { signToken } from "../lib/auth";
import { loginUser, logoutUser, getMe, changePassword } from "../services/auth.service";
import { logAudit } from "../lib/audit";
import { ipRateLimit } from "../middlewares/rateLimiter";

const router = Router();

// Zod schema for login body — enforces length limits to prevent abuse
const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});


// Shared helper: build and set the session cookie for a user after full auth
const COOKIE_TTL_MS: Record<string, number> = {
  super_admin:        15 * 60 * 1000,
  admin:          1 * 60 * 60 * 1000,
  doctor:         2 * 60 * 60 * 1000,
  nurse:          2 * 60 * 60 * 1000,
  compliance_officer: 2 * 60 * 60 * 1000,
  billing_manager: 4 * 60 * 60 * 1000,
  front_desk:      4 * 60 * 60 * 1000,
  xray_staff:      4 * 60 * 60 * 1000,
  lab_staff:       4 * 60 * 60 * 1000,
  pharmacist:      4 * 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

router.post("/auth/login", asyncHandler(async (req: AuthRequest, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Username and password required (max 64 / 256 chars)" });
    return;
  }
  const { username, password } = parsed.data;

  let result;
  try {
    result = await loginUser(username, password, {
      ip: req.ip || "unknown",
      userAgent: req.headers["user-agent"],
      acceptLanguage: req.headers["accept-language"],
    });
  } catch (err: any) {
    if (err.status === 429) {
      res.status(429).json({ error: err.message, retryAfterSecs: err.retryAfterSecs });
      return;
    }
    if (err.status === 401) {
      res.status(401).json({ error: err.message, attemptsRemaining: err.attemptsRemaining });
      return;
    }
    throw err;
  }

  // Full session — set cookies
  const isProduction = process.env.NODE_ENV === "production";
  const cookieMaxAge = COOKIE_TTL_MS[result.user.role] ?? 4 * 60 * 60 * 1000;
  res.cookie("clinic_token", result.token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    maxAge: cookieMaxAge,
    path: "/",
  });
  setCsrfCookie(res);

  res.json({ user: result.user });
}));


// Logout / session
// ---------------------------------------------------------------------------

router.post("/auth/logout", requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  try {
    await logoutUser(req.user!.userId, req.ip || "unknown");
  } catch (err) {
    req.log?.warn({ err, userId: req.user!.userId }, "logout revocation failed; clearing cookie anyway");
  }

  res.clearCookie("clinic_token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
  });
  clearCsrfCookie(res);

  res.json({ success: true });
}));

router.get("/auth/me", requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getMe(req.user!.userId));
}));

router.post("/auth/change-password", requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "Current password and new password are required" });
    return;
  }
  await changePassword(req.user!.userId, currentPassword, newPassword, req.ip || "unknown");
  res.json({ success: true });
}));

export default router;
