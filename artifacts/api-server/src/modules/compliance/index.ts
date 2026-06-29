/**
 * Compliance module — public surface (barrel).
 *
 * Owns patient consent, break-glass emergency access (+ its audited PHI-read
 * bypass), and right-to-erasure. This is a LOWER layer that clinical and imaging
 * depend on: `break-glass.service.getActiveBreakGlassPatientIds` and
 * `consent.service.hasActiveConsent` are consumed cross-module by
 * lab/prescriptions/medical-records (still in services/) and the imaging module.
 *
 * Import the module's services via this folder; all three routers are authed.
 */
export { default as consentRouter } from "./consent.routes";
export { default as breakGlassRouter } from "./break-glass.routes";
export { default as erasureRouter } from "./erasure.routes";
