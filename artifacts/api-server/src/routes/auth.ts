import { Router } from "express";
import { z } from "zod/v4";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { authGate } from "../middlewares/auth-gate";
import { asyncHandler } from "../middlewares/asyncHandler";
import { ValidationError } from "../services/errors";
import { setCsrfCookie, clearCsrfCookie } from "../lib/csrf-cookie";
import { signToken } from "../lib/auth";
import { COOKIE_TTL_MS } from "../lib/auth-constants";
import { loginUser, logoutUser, getMe, changePassword } from "../services/auth.service";
import { logAudit } from "../lib/audit";
import { ipRateLimit } from "../middlewares/rateLimiter";
import { config } from "../lib/config";
import {
  setDeviceCookie,
  readDeviceCookie,
  DEVICE_COOKIE_NAME,
} from "../lib/device-fingerprint";

const router = Router();

// Zod schema for login body — enforces length limits to prevent abuse
const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

router.post("/auth/login", asyncHandler(async (req: AuthRequest, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError("Username and password required (max 64 / 256 chars)");
  }
  const { username, password } = parsed.data;

  let result;
  try {
    result = await loginUser(username, password, {
      ip: req.ip || "unknown",
      userAgent: req.headers["user-agent"],
      acceptLanguage: req.headers["accept-language"],
      deviceIdCookie: readDeviceCookie(req),
      platform: req.headers["sec-ch-ua-platform"] as string | undefined,
      clientHints: req.headers["x-client-hints"] as string | undefined,
    });
  } catch (err: any) {
    // These two response shapes stay raw (NOT the canonical envelope) because the
    // frontend Login page reads `retryAfterSecs` / `attemptsRemaining` from the
    // body to render lockout UX. The canonical envelope has no slot for those
    // fields; promoting them would require a shape extension across the surface.
    // Tracked as a follow-up — see PR-A2 description.
    if (err.status === 429) {
      res.set("Retry-After", String(err.retryAfterSecs));
      res.status(429).json({ error: err.message, retryAfterSecs: err.retryAfterSecs });
      return;
    }
    if (err.status === 401) {
      res.status(401).json({ error: err.message, attemptsRemaining: err.attemptsRemaining });
      return;
    }
    throw err;
  }

  // Phase 2 — privileged-role new-device block. No session issued.
  if (result.outcome === "pending_verification") {
    setDeviceCookie(res, result.deviceId);
    // Generic shape that does NOT leak account existence (matches
    // forgot-password response surface).
    res.status(202).json({
      status: "pending_verification",
      message: result.message,
    });
    return;
  }

  // Full session — set cookies
  const isProduction = config.isProd;
  const cookieMaxAge = COOKIE_TTL_MS[result.user.role] ?? 4 * 60 * 60 * 1000;
  res.cookie("clinic_token", result.token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "strict",
    maxAge: cookieMaxAge,
    path: "/",
  });
  setCsrfCookie(res);
  setDeviceCookie(res, result.deviceId);

  res.json({
    user: result.user,
    deviceUnverified: result.deviceUnverified,
  });
}));


// Logout / session
// ---------------------------------------------------------------------------

router.post("/auth/logout", requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  try {
    await logoutUser(req.user!.userId, req.ip || "unknown", req.user!.clinicId);
  } catch (err) {
    req.log?.warn({ err, userId: req.user!.userId }, "logout revocation failed; clearing cookie anyway");
  }

  res.clearCookie("clinic_token", {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "strict",
    path: "/",
  });
  clearCsrfCookie(res);

  res.json({ success: true });
}));

router.get("/auth/me", requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const user = await getMe(req.user!.userId);
  res.json({ ...user, jwtExpUnix: req.user!.jwtExpUnix });
}));

router.post("/auth/change-password", requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw new ValidationError("Current password and new password are required");
  }
  await changePassword(req.user!.userId, currentPassword, newPassword, req.ip || "unknown");
  res.json({ success: true });
}));

export default router;
