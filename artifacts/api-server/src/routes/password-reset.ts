// Phase 2 — password reset routes.
//
//   POST /auth/forgot-password  — anonymous, byte-identical response.
//   POST /auth/reset-password   — anonymous, consumes a self-service token.
//   POST /auth/admin-reset/:userId — admin/compliance_officer only, returns
//                                    a short-lived raw token to the admin.

import { Router } from "express";
import { z } from "zod/v4";
import { asyncHandler } from "../middlewares/asyncHandler";
import { authGate, type AuthRequest } from "../middlewares/auth-gate";
import { requireStepUp } from "../middlewares/step-up";
import { ValidationError } from "../services/errors";
import {
  issueSelfServiceReset,
  issueAdminReset,
  consumePasswordReset,
  SELF_SERVICE_RESPONSE,
} from "../services/password-reset.service";
import { logAudit } from "../lib/audit";

const router = Router();

// ---------------------------------------------------------------------------
// POST /auth/forgot-password — anonymous, no enumeration oracle
// ---------------------------------------------------------------------------

const forgotSchema = z.object({ username: z.string().min(1).max(64) });

router.post(
  "/auth/forgot-password",
  asyncHandler(async (req, res) => {
    const parsed = forgotSchema.safeParse(req.body);
    if (!parsed.success) {
      // Even on bad-shape requests, return the generic message so an attacker
      // who probes shape can't infer behavior.
      res.json(SELF_SERVICE_RESPONSE);
      return;
    }
    // Fire-and-forget so response timing is independent of whether the
    // account exists. We don't await the email send.
    void issueSelfServiceReset(parsed.data.username).catch(() => {
      /* swallow — never leak */
    });
    res.json(SELF_SERVICE_RESPONSE);
  }),
);

// ---------------------------------------------------------------------------
// POST /auth/reset-password — anonymous, atomic consume
// ---------------------------------------------------------------------------

const resetSchema = z.object({
  token: z.string().min(16).max(256),
  newPassword: z.string().min(8).max(256),
});

router.post(
  "/auth/reset-password",
  asyncHandler(async (req, res) => {
    const parsed = resetSchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Token and new password required");

    const result = await consumePasswordReset({
      rawToken: parsed.data.token,
      newPassword: parsed.data.newPassword,
    });

    if (!result.ok) {
      if (result.reason === "weak_password") {
        res.status(400).json({
          success: false,
          error_code: 1110,
          error_name: "WEAK_PASSWORD",
          message: result.passwordReason ?? "Password does not meet requirements.",
        });
        return;
      }
      res.status(400).json({
        success: false,
        error_code: 1111,
        error_name: "INVALID_RESET_TOKEN",
        message: "This reset link has expired or already been used.",
      });
      return;
    }

    res.json({ status: "reset_complete" });
  }),
);

// ---------------------------------------------------------------------------
// POST /auth/admin-reset/:userId — privileged
// ---------------------------------------------------------------------------

router.post(
  "/auth/admin-reset/:userId",
  authGate("privileged", ["super_admin", "admin", "compliance_officer"]),
  requireStepUp("admin_reset"),
  asyncHandler(async (req: AuthRequest, res) => {
    const targetUserId = parseInt(String(req.params.userId ?? ""), 10);
    if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
      throw new ValidationError("Invalid user id");
    }
    const { rawToken, expiresAt } = await issueAdminReset(targetUserId);
    try {
      await logAudit(
        req as never,
        "ADMIN_PASSWORD_RESET_ISSUED",
        "user",
        targetUserId,
      );
    } catch { /* */ }
    res.json({
      rawToken,
      expiresAt,
      note:
        "Deliver this token to the user out-of-band. Single-use, 30-minute TTL.",
    });
  }),
);

export default router;
