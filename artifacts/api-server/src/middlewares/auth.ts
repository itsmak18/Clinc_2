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

// Pick the kernel scope by HTTP method (F-P2-5). Mutations get `write` (CSRF +
// fail-closed revocation); safe methods get `read` so they benefit from ADR-010's
// bounded fail-open during a revocation-store blip instead of failing closed.
// CSRF is method-gated in the kernel anyway, so a GET under `write` never enforced
// CSRF — this loses nothing and only relaxes the revocation behavior for reads.
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
function scopeForMethod(method: string): "read" | "write" {
  return MUTATION_METHODS.has(method.toUpperCase()) ? "write" : "read";
}

/**
 * Drop-in replacement for the old `requireAuth`. Delegates to `authGate`:
 * token required, CSRF enforced on mutation methods, revocation fail-closed on
 * mutations and bounded fail-open on reads.
 */
export const requireAuth: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  return authGate(scopeForMethod(req.method))(req, res, next);
};

/**
 * Drop-in replacement for the old `requireRole(...roles)`. Delegates to
 * `authGate(scopeForMethod(method), roles)`. super_admin is bypassed inside the kernel.
 *
 * NOTE: because requireAuth is typically mounted at router level and
 * requireRole at per-route level, this shim re-runs the full kernel on each
 * call. That's intentional: idempotent, no measurable cost on a request that
 * already passed authGate once.
 */
export type UserRole = "super_admin" | "admin" | "doctor" | "nurse" | "front_desk"
  | "xray_staff" | "lab_staff" | "compliance_officer" | "billing_manager" | "pharmacist";

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    return authGate(scopeForMethod(req.method), roles)(req, res, next);
  };
}
