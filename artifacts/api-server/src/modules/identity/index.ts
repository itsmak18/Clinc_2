/**
 * Identity module — public surface (barrel).
 *
 * Owns authentication, users, device-trust (+ verification), and password reset.
 * Import the module ONLY through this barrel — never a deep
 * `modules/identity/<x>.service` path from outside.
 *
 * Router ordering matters in routes/index.ts and is preserved there, NOT here:
 *   - `jwksRouter`, `authRouter`, `devicesRouter`, `passwordResetRouter` are
 *     anonymous/early and MUST register before the authed routers (their
 *     handlers run pre-auth or mount their own gates).
 *   - `usersRouter` is authed.
 *
 * Note: `email.service` is intentionally NOT part of this module — it is shared
 * infra (consumed here via ../../services/email.service) and will move to the
 * platform/notifications layer in a later step.
 */
export { default as jwksRouter } from "./jwks.routes";
export { default as authRouter } from "./auth.routes";
export { default as devicesRouter } from "./devices.routes";
export { default as passwordResetRouter } from "./password-reset.routes";
export { default as usersRouter } from "./users.routes";
