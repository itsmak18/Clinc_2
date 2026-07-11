/**
 * Clinical module — public surface (barrel).
 *
 * The EHR core: patients, appointments (the visit state-machine hub), medical
 * records, prescriptions, nurse vitals, lab, doctor schedule (+ slot generation),
 * and clinic-wide notices. Import the module ONLY through this barrel.
 *
 * `autoAdvanceVisit` is consumed cross-module by billing and imaging — re-exported
 * below so those modules import `../clinical` instead of reaching past the barrel
 * into `../clinical/appointments.service` (2026-07-02 architecture audit, F4).
 * Clinical depends downward on the compliance module (consent + break-glass) via
 * ../compliance (also barrel-only). All routers authed.
 */
export { default as patientsRouter } from "./patients.routes";
export { default as appointmentsRouter } from "./appointments.routes";
export { default as medicalRecordsRouter } from "./medical-records.routes";
export { default as vitalsRouter } from "./vitals.routes";
export { default as clinicNoticesRouter } from "./clinic-notices.routes";
export { default as prescriptionsRouter } from "./prescriptions.routes";
export { default as labRouter } from "./lab.routes";
export { default as scheduleRouter } from "./schedule.routes";
export { autoAdvanceVisit } from "./appointments.service";
