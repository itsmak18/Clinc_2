// Phase 2 — capability gating on unverified devices.
//
// When the session JWT carries `dvu=true` (issued because the user logged in
// from a new device that did NOT get email confirmation), routes that touch
// bulk PHI, exports, or account settings should refuse with 403
// "device_unverified". The user can either:
//   (a) click the email link to promote the device to trusted, or
//   (b) wait 24h of normal activity for auto-trust (handled by a separate
//       sweep job — out of scope for this middleware).
//
// When the master kill-switch is OFF this middleware is a no-op.

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { verifyToken } from "../lib/auth";
import { isPhase2Enabled } from "../lib/auth-constants";

interface AuthCookies {
  clinic_token?: string;
}

export interface DenyDeviceUnverifiedOpts {
  /** Override response copy. */
  message?: string;
}

/**
 * Block the request if the caller's JWT has `dvu=true`. Must be mounted
 * AFTER authGate so `req.user` is populated, OR it will independently
 * verify the cookie token (so it can be used standalone on edge routes).
 */
export function denyIfDeviceUnverified(
  opts: DenyDeviceUnverifiedOpts = {},
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!isPhase2Enabled()) {
      next();
      return;
    }

    const cookies = (req as Request & { cookies?: AuthCookies }).cookies;
    const token = cookies?.clinic_token;
    if (!token) {
      next();
      return;
    }

    try {
      const payload = await verifyToken(token, {
        "user-agent": req.headers["user-agent"],
        "accept-language": req.headers["accept-language"],
      });
      if (payload.dvu === true) {
        res.status(403).json({
          success: false,
          error_code: 1100,
          error_name: "DEVICE_UNVERIFIED",
          message:
            opts.message ??
            "This action is blocked on unverified devices. " +
              "Open the verification email we sent, or wait 24h of normal activity.",
        });
        return;
      }
    } catch {
      // Let downstream auth middleware handle invalid tokens.
    }

    next();
  };
}
