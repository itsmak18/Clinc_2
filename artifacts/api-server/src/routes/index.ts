import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import patientsRouter from "./patients";
import appointmentsRouter from "./appointments";
import medicalRecordsRouter from "./medical_records";
import vitalsRouter from "./vitals";
import clinicNoticesRouter from "./clinic_notices";
import prescriptionsRouter from "./prescriptions";
import xrayRouter from "./xray";
import ultrasoundRouter from "./ultrasound";
import labRouter from "./lab";
import billingRouter from "./billing";
import operationsRouter from "./operations";
import inventoryRouter from "./inventory";
import notificationsRouter from "./notifications";
import auditRouter from "./audit";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import searchRouter from "./search";
import scheduleRouter from "./schedule";
import consentRouter from "./consent";
import breakGlassRouter from "./break-glass";
import erasureRouter from "./erasure";
import devicesRouter from "./devices";
import passwordResetRouter from "./password-reset";
import cspReportRouter from "./csp-report";
import jwksRouter from "./jwks";
import analyticsRouter from "./analytics";
import servicesCatalogRouter from "./services-catalog";

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
