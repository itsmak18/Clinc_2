// Phase 2 — step-up re-authentication for destructive actions.
//
// Mount on routes like: DELETE /users/:id, POST /invoices/:id/void,
// POST /users/:id/role, POST /patients/:id/export.
//
// Client contract: the request must carry an `X-Step-Up` header containing
// the current user's password (over HTTPS-only origin). We re-verify against
// the stored hash, write an audit row, and pass through on success. Reject
// with 401 "step_up_required" otherwise so the FE can prompt for password
// inline before retrying.
//
// When PHASE2_STEP_UP_ENABLED is OFF this middleware is a no-op.

import type { Request, Response, NextFunction, RequestHandler } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyPassword } from "../lib/password";
import { isStepUpEnabled } from "../lib/auth-constants";
import { logAudit } from "../lib/audit";
import type { AuthRequest } from "./auth-gate";

export function requireStepUp(action: string): RequestHandler {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!isStepUpEnabled()) {
      next();
      return;
    }

    const authReq = req as AuthRequest;
    if (!authReq.user) {
      res.status(401).json({
        success: false,
        error_code: 1101,
        error_name: "STEP_UP_NO_SESSION",
        message: "Authenticate first.",
      });
      return;
    }

    const supplied = req.headers["x-step-up"];
    if (typeof supplied !== "string" || supplied.length === 0) {
      res.status(401).json({
        success: false,
        error_code: 1102,
        error_name: "STEP_UP_REQUIRED",
        message: "Re-enter your password to continue.",
      });
      return;
    }

    const [user] = await db
      .select({ passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.id, authReq.user.userId))
      .limit(1);
    if (!user) {
      res.status(401).json({
        success: false,
        error_code: 1103,
        error_name: "STEP_UP_USER_GONE",
        message: "Session is no longer valid.",
      });
      return;
    }

    const ok = await verifyPassword(supplied, user.passwordHash);
    if (!ok) {
      try {
        await logAudit(req as never, "STEP_UP_FAILED", "user", authReq.user.userId, {
          action,
        });
      } catch { /* */ }
      res.status(401).json({
        success: false,
        error_code: 1104,
        error_name: "STEP_UP_BAD_PASSWORD",
        message: "Incorrect password.",
      });
      return;
    }

    try {
      await logAudit(req as never, "STEP_UP_OK", "user", authReq.user.userId, {
        action,
      });
    } catch { /* */ }

    next();
  };
}
