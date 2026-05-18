/**
 * Legacy `requireAuth` + `requireRole` middlewares — kept as thin shims over
 * the v7 auth kernel (`authGate`). New routes should prefer importing
 * `authGate` directly from `./auth-gate`. The kernel (`lib/policy.ts`) is the
 * single source of truth for CSRF + identity + revocation + jti + fingerprint
 * + role. These shims exist so existing routers keep working unchanged.
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { authGate, type AuthRequest } from "./auth-gate";

export type { AuthRequest };

/**
 * Drop-in replacement for the old `requireAuth`. Delegates to
 * `authGate("write")`: token required, CSRF enforced on mutation methods,
 * revocation fail-closed.
 */
export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  return authGate("write")(req, res, next);
};

/**
 * Drop-in replacement for the old `requireRole(...roles)`. Delegates to
 * `authGate("write", roles)`. super_admin is bypassed inside the kernel.
 *
 * NOTE: because requireAuth is typically mounted at router level and
 * requireRole at per-route level, this shim re-runs the full kernel on each
 * call. That's intentional: idempotent, no measurable cost on a request that
 * already passed authGate once.
 */
export function requireRole(...roles: string[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    return authGate("write", roles)(req, res, next);
  };
}
