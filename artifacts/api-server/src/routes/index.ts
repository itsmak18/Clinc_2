import { Router, type IRouter } from "express";
import { healthRouter } from "../modules/health";
// Feature module: identity (auth, users, devices, password-reset, jwks).
// Consumed via its barrel; the router.use() positions below are unchanged so the
// anonymous-before-authed ordering is preserved.
import {
  jwksRouter, authRouter, devicesRouter, passwordResetRouter, usersRouter,
} from "../modules/identity";
// Feature module: clinical (patients, appointments, medical-records, prescriptions,
// vitals, lab, schedule, clinic-notices). Barrel-consumed; router.use() positions
// below unchanged.
import {
  patientsRouter, appointmentsRouter, medicalRecordsRouter, vitalsRouter,
  clinicNoticesRouter, prescriptionsRouter, labRouter, scheduleRouter,
} from "../modules/clinical";
// Feature module: imaging (xray, ultrasound, imaging-attachments). Barrel-consumed;
// router.use() positions below unchanged.
import { xrayRouter, ultrasoundRouter } from "../modules/imaging";
// Feature module: billing (billing, services-catalog). Consumed via barrel;
// router.use() positions below unchanged.
import { billingRouter, servicesCatalogRouter, paymentsRouter } from "../modules/billing";
import { operationsRouter } from "../modules/operations";
// Feature-module pilot: inventory now lives in src/modules/inventory and is
// consumed through its barrel. Registration position below is unchanged.
import { inventoryRouter } from "../modules/inventory";
import { notificationsRouter } from "../modules/notifications";
// Feature module: audit (audit, csp-report). Barrel-consumed; router.use()
// positions below unchanged (csp-report is anonymous, registered early).
import { auditRouter, cspReportRouter } from "../modules/audit";
// Feature module: reporting (dashboard, reports, analytics). Barrel-consumed;
// router.use() positions below unchanged.
import { dashboardRouter, reportsRouter, analyticsRouter } from "../modules/reporting";
import { searchRouter } from "../modules/search";
// Feature module: compliance (consent, break-glass, erasure). Barrel-consumed;
// router.use() positions below unchanged.
import { consentRouter, breakGlassRouter, erasureRouter } from "../modules/compliance";

const router: IRouter = Router();

router.use(jwksRouter);
router.use(healthRouter);
router.use(authRouter);
// Phase 2 anonymous routes must be registered BEFORE any router that mounts a
// global `router.use(requireAuth)`, otherwise the catch-all auth middleware
// intercepts unauthenticated requests intended for these public endpoints.
router.use(devicesRouter);
router.use(passwordResetRouter);
router.use(cspReportRouter);
router.use(usersRouter);
router.use(patientsRouter);
router.use(appointmentsRouter);
router.use(medicalRecordsRouter);
router.use(vitalsRouter);
router.use(clinicNoticesRouter);
router.use(prescriptionsRouter);
router.use(xrayRouter);
router.use(ultrasoundRouter);
router.use(labRouter);
router.use(billingRouter);
router.use(paymentsRouter);
router.use(operationsRouter);
router.use(inventoryRouter);
router.use(notificationsRouter);
router.use(auditRouter);
router.use(dashboardRouter);
router.use(reportsRouter);
router.use(searchRouter);
router.use(scheduleRouter);
router.use(consentRouter);
router.use(breakGlassRouter);
router.use(erasureRouter);
router.use(analyticsRouter);
router.use(servicesCatalogRouter);

export default router;
