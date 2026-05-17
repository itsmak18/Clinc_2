import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { setCsrfCookie, clearCsrfCookie } from "../middlewares/csrf";
import { loginUser, logoutUser, getMe, changePassword } from "../services/auth.service";
import {
  enrollMfa, confirmMfaEnrollment, verifyMfaToken, consumeRecoveryCode, disableMfa,
} from "../services/mfa.service";
import { logAudit } from "../lib/audit";

const router = Router();

router.post("/auth/login", asyncHandler(async (req: AuthRequest, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  let result;
  try {
    result = await loginUser(username, password, {
      ip: req.ip || "unknown",
      userAgent: req.headers["user-agent"],
      acceptLanguage: req.headers["accept-language"],
    });
  } catch (err: any) {
    // Rate-limit and credential errors carry status + extra fields — pass them through
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

  const isProduction = process.env.NODE_ENV === "production";
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

// ---------------------------------------------------------------------------
// MFA endpoints — all require an authenticated session
// ---------------------------------------------------------------------------

// Step 1: start enrolment — returns QR code + plaintext secret (show once)
router.post("/auth/mfa/enroll", requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { qrDataUrl, secret, recoveryCodes } = await enrollMfa(req.user!.userId);
  res.json({ qrDataUrl, secret, recoveryCodes });
}));

// Step 2: confirm enrolment by submitting a valid TOTP token + the recovery codes to hash+store
router.post("/auth/mfa/confirm", requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { token, recoveryCodes } = req.body;
  if (!token || !Array.isArray(recoveryCodes) || recoveryCodes.length !== 10) {
    res.status(400).json({ error: "token and 10 recoveryCodes are required" });
    return;
  }
  await confirmMfaEnrollment(req.user!.userId, String(token), recoveryCodes);
  void logAudit(req, "MFA_ENROLLED", "user", req.user!.userId);
  res.json({ success: true });
}));

// Verify a TOTP code (used during login second-step if implemented; also useful for sensitive ops)
router.post("/auth/mfa/verify", requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { token } = req.body;
  if (!token) { res.status(400).json({ error: "token is required" }); return; }
  const valid = await verifyMfaToken(req.user!.userId, String(token));
  if (!valid) {
    void logAudit(req, "MFA_VERIFY_FAILED", "user", req.user!.userId);
    res.status(401).json({ error: "Invalid or expired TOTP code" });
    return;
  }
  void logAudit(req, "MFA_VERIFIED", "user", req.user!.userId);
  res.json({ success: true });
}));

// Consume a one-time recovery code
router.post("/auth/mfa/recovery", requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const { code } = req.body;
  if (!code) { res.status(400).json({ error: "code is required" }); return; }
  await consumeRecoveryCode(req.user!.userId, String(code));
  void logAudit(req, "MFA_RECOVERY_USED", "user", req.user!.userId);
  res.json({ success: true });
}));

// Disable MFA (self: always allowed; other user: super_admin only)
router.post("/auth/mfa/disable", requireAuth, asyncHandler(async (req: AuthRequest, res) => {
  const targetId = req.body.userId ? parseInt(req.body.userId) : req.user!.userId;
  await disableMfa(targetId, req.user!.userId, req.user!.role);
  void logAudit(req, "MFA_DISABLED", "user", targetId);
  res.json({ success: true });
}));

export default router;
