/**
 * Imaging module — public surface (barrel).
 *
 * Owns X-ray + ultrasound records and their encrypted file attachments
 * (imaging-attachments.service backs the upload/stream/delete endpoints mounted
 * on the xray + ultrasound routers). Import the module ONLY through this barrel.
 *
 * Cross-module deps: xray/ultrasound/attachments services reach
 * `getActiveBreakGlassPatientIds` (emergency PHI read) via the compliance
 * module's barrel (`../compliance`) and `autoAdvanceVisit` via the clinical
 * module's barrel (`../clinical`) — not deep `.service` paths
 * (2026-07-02 architecture audit, F4).
 */
export { default as xrayRouter } from "./xray.routes";
export { default as ultrasoundRouter } from "./ultrasound.routes";
