// Phase 2 — device verification + management routes.
//
//   POST /auth/verify-device  — consume a verification token (anonymous; the
//                                token itself is the credential). On success
//                                issues a session and trusts the device.
//   POST /auth/wasnt-me        — anonymous; revoke all sessions for the user,
//                                lock privileged accounts, force password reset.
//   GET  /account/devices      — list the caller's trusted devices.
//   DELETE /account/devices/:deviceId — revoke a device.

import { Router } from "express";
import { z } from "zod/v4";
import { asyncHandler } from "../middlewares/asyncHandler";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import {
  consumeVerificationToken,
  peekToken,
} from "../services/device-verification.service";
import {
  markDeviceTrusted,
  revokeDevice,
  listDevicesForUser,
  findActiveUserForLogin,
  lockUserIfPrivileged,
  listComplianceOfficerEmails,
} from "../services/device-trust.service";
import {
  computeFingerprint,
  setDeviceCookie,
} from "../lib/device-fingerprint";
import { signToken, revokeAllTokensForUser } from "../lib/auth";
import { setCsrfCookie } from "../lib/csrf-cookie";
import { COOKIE_TTL_MS, isPhase2Enabled } from "../lib/auth-constants";
import { ValidationError } from "../services/errors";
import { logAudit } from "../lib/audit";
import { sendEmail } from "../services/email.service";

const router = Router();


// ---------------------------------------------------------------------------
// POST /auth/verify-device — anonymous, fingerprint-bound
// ---------------------------------------------------------------------------

const verifySchema = z.object({ token: z.string().min(16).max(256) });

router.post(
  "/auth/verify-device",
  asyncHandler(async (req, res) => {
    if (!isPhase2Enabled()) {
      res.status(503).json({ error: "phase2_disabled" });
      return;
    }
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Token required");

    // Two-step: peek to learn userId, derive the correct fingerprint, then
    // atomically consume. A second click finds consumed_at set → fails closed.
    const peeked = await peekToken(parsed.data.token);
    if (!peeked) {
      res.status(400).json({ error: "invalid" });
      return;
    }

    const fp = computeFingerprint({
      userId: peeked.userId,
      userAgent: req.headers["user-agent"],
      platform: req.headers["sec-ch-ua-platform"] as string | undefined,
      clientHints: req.headers["x-client-hints"] as string | undefined,
    });

    const consume = await consumeVerificationToken({
      rawToken: parsed.data.token,
      currentFingerprintHash: fp,
    });
    if (!consume.ok) {
      res.status(400).json({ error: consume.reason ?? "invalid" });
      return;
    }
    const token = consume.token!;

    // Promote the device to trusted + issue a session.
    await markDeviceTrusted(token.userId, token.pendingDeviceId, "email_confirmed");

    const user = await findActiveUserForLogin(token.userId);
    if (!user) {
      res.status(400).json({ error: "user_inactive" });
      return;
    }

    const jwt = await signToken(
      { userId: user.id, username: user.username, role: user.role },
      {
        "user-agent": req.headers["user-agent"],
        "accept-language": req.headers["accept-language"],
      },
    );
    const isProd = process.env.NODE_ENV === "production";
    res.cookie("clinic_token", jwt, {
      httpOnly: true,
      secure: isProd,
      sameSite: "strict",
      maxAge: COOKIE_TTL_MS[user.role] ?? 4 * 60 * 60 * 1000,
      path: "/",
    });
    setCsrfCookie(res);
    setDeviceCookie(res, token.pendingDeviceId);

    try {
      await logAudit(
        { user: { userId: user.id }, ip: req.ip, headers: req.headers } as never,
        "DEVICE_TRUSTED",
        "user_device",
        user.id,
      );
    } catch { /* fire-and-forget */ }

    res.json({
      user: {
        id: user.id, username: user.username, fullName: user.fullName,
        fullNameAr: user.fullNameAr, email: user.email, role: user.role, isActive: user.isActive,
      },
    });
  }),
);

// ---------------------------------------------------------------------------
// POST /auth/wasnt-me — anonymous kill switch
// ---------------------------------------------------------------------------

router.post(
  "/auth/wasnt-me",
  asyncHandler(async (req, res) => {
    if (!isPhase2Enabled()) {
      res.status(503).json({ error: "phase2_disabled" });
      return;
    }
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) throw new ValidationError("Token required");

    const consume = await consumeVerificationToken({
      rawToken: parsed.data.token,
      currentFingerprintHash: "",
      // Kill-switch path: rightful owner may click from any device.
      bypassFingerprint: true,
    });
    const token = consume.token;
    if (!token) {
      res.status(400).json({ error: "expired_or_consumed" });
      return;
    }

    await Promise.all([
      revokeDevice(token.userId, token.pendingDeviceId),
      revokeAllTokensForUser(token.userId),
    ]);

    const locked = await lockUserIfPrivileged(token.userId);

    try {
      await logAudit(
        { user: { userId: token.userId }, ip: req.ip, headers: req.headers } as never,
        "DEVICE_REJECTED",
        "user_device",
        token.userId,
      );
    } catch { /* */ }

    // Notify all compliance officers via email (best-effort).
    try {
      const emails = await listComplianceOfficerEmails();
      await Promise.all(
        emails.map((to) =>
          sendEmail({
            to,
            subject:
              "MediCore — \"wasn't me\" click on user account (review required)",
            text:
              `A user clicked the kill-switch link after a new-device login.\n` +
              `User id: ${token.userId}\n` +
              `Privileged role lock: ${locked?.locked ? "YES" : "no"}\n` +
              `All sessions revoked. Review in audit log immediately.`,
            tag: "compliance_alert",
          }),
        ),
      );
    } catch { /* */ }

    res.json({ status: "revoked" });
  }),
);

// ---------------------------------------------------------------------------
// GET /account/devices — authenticated
// ---------------------------------------------------------------------------

router.get(
  "/account/devices",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const rows = await listDevicesForUser(req.user!.userId);
    res.json({
      devices: rows.map((d) => ({
        deviceId: d.deviceId,
        firstSeen: d.firstSeen,
        lastSeen: d.lastSeen,
        ipLast: d.ipLast,
        countryLast: d.countryLast,
        trusted: d.trusted,
        trustSource: d.trustSource,
        trustExpiresAt: d.trustExpiresAt,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// DELETE /account/devices/:deviceId — authenticated
// ---------------------------------------------------------------------------

router.delete(
  "/account/devices/:deviceId",
  requireAuth,
  asyncHandler(async (req: AuthRequest, res) => {
    const deviceId = String(req.params.deviceId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(deviceId)) {
      throw new ValidationError("Invalid device id");
    }
    await revokeDevice(req.user!.userId, deviceId);
    try {
      await logAudit(
        req as never,
        "DEVICE_REVOKED",
        "user_device",
        req.user!.userId,
      );
    } catch { /* */ }
    res.json({ status: "revoked" });
  }),
);

export default router;
