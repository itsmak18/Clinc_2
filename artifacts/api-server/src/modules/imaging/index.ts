/**
 * Imaging module — public surface (barrel).
 *
 * Owns X-ray + ultrasound records and their encrypted file attachments
 * (imaging-attachments.service backs the upload/stream/delete endpoints mounted
 * on the xray + ultrasound routers). Import the module ONLY through this barrel.
 *
 * Cross-module deps (until those modules migrate): xray/ultrasound/attachments
 * services reach `break-glass.service` (emergency PHI read) and `appointments.service`
 * (autoAdvanceVisit) via ../../services/.
 */
export { default as xrayRouter } from "./xray.routes";
export { default as ultrasoundRouter } from "./ultrasound.routes";
