/**
 * Compliance module — public surface (barrel).
 *
 * Owns patient consent, break-glass emergency access (+ its audited PHI-read
 * bypass), and right-to-erasure. This is a LOWER layer that clinical, imaging,
 * and the lib/scope.ts kernel depend on: `getActiveBreakGlassPatientIds` /
 * `hasActiveConsent` / `getActiveSession` / `logBreakGlassAccess` are consumed
 * cross-module by clinical (lab/prescriptions/medical-records), imaging, and
 * lib/scope.ts — re-exported below so those callers import `../compliance` (or
 * `../modules/compliance` from lib/) instead of reaching past the barrel into
 * `./break-glass.service` / `./consent.service` (2026-07-02 architecture audit, F4).
 *
 * Import the module ONLY through this barrel; all three routers are authed.
 */
export { default as consentRouter } from "./consent.routes";
export { default as breakGlassRouter } from "./break-glass.routes";
export { default as erasureRouter } from "./erasure.routes";
export { getActiveBreakGlassPatientIds, getActiveSession, logBreakGlassAccess } from "./break-glass.service";
export { hasActiveConsent } from "./consent.service";
