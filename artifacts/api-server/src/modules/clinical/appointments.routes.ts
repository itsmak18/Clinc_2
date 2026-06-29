import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../../middlewares/auth";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { validate } from "../../middlewares/validate";
import { CreateAppointmentBody, UpdateAppointmentBody } from "@workspace/api-zod";
import { ValidationError } from "../../services/errors";
import { safeParseInt } from "../../lib/validators";
import { logAudit } from "../../lib/audit";
import {
  listAppointments, createAppointment, getAppointmentFlow, getTodayAppointments,
  getAppointment, patchAppointment, cancelAppointment, checkinAppointment,
  readyAppointment, transitionAppointment, getDischarge,
} from "./appointments.service";

const router = Router();
router.use(requireAuth);
router.use("/appointments", requireRole("super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"));

router.get("/appointments", asyncHandler(async (req: AuthRequest, res) => {
  const { status, date, doctorId, patientId, limit, cursor } = req.query as Record<string, string | undefined>;
  res.json(await listAppointments(req, { status, date, doctorId, patientId, limit, cursor }));
}));

router.post("/appointments",
  // Booking is an intake duty: front desk / admin, plus doctors (follow-ups).
  // Nurses run the clinical flow via the status transitions below, not creation;
  // lab/xray inherit the group read-gate but must not create appointments.
  requireRole("super_admin", "admin", "doctor", "front_desk"),
  validate(CreateAppointmentBody),
  asyncHandler(async (req: AuthRequest, res) => {
    res.status(201).json(await createAppointment(req, req.body));
  }),
);

router.get("/appointments/flow",
  requireRole("super_admin", "admin", "doctor", "nurse", "front_desk"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json(await getAppointmentFlow(req));
  }),
);

router.get("/appointments/today", asyncHandler(async (req: AuthRequest, res) => {
  res.json(await getTodayAppointments(req));
}));

router.get("/appointments/:appointmentId", asyncHandler(async (req: AuthRequest, res) => {
  const id = safeParseInt(req.params.appointmentId);
  if (!id) throw new ValidationError("Invalid appointment ID");
  res.json(await getAppointment(req, id));
}));

router.patch("/appointments/:appointmentId",
  requireRole("super_admin", "admin", "front_desk", "doctor", "nurse"),
  validate(UpdateAppointmentBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) throw new ValidationError("Invalid appointment ID");
    res.json(await patchAppointment(req, id, req.body));
  }),
);

router.delete("/appointments/:appointmentId",
  requireRole("super_admin", "admin", "front_desk"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) throw new ValidationError("Invalid appointment ID");
    await cancelAppointment(req, id, req.body?.cancellationReason);
    res.json({ success: true });
  }),
);

router.post("/appointments/:appointmentId/checkin",
  requireRole("super_admin", "admin", "front_desk", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) throw new ValidationError("Invalid appointment ID");
    res.json(await checkinAppointment(req, id));
  }),
);

router.post("/appointments/:appointmentId/triage",
  requireRole("super_admin", "admin", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) throw new ValidationError("Invalid appointment ID");
    const { appt } = await transitionAppointment(req, id, "triage", { triageStartedAt: new Date() });
    await logAudit(req, "TRIAGE_START", "appointment", appt.id);
    res.json(appt);
  }),
);

router.post("/appointments/:appointmentId/ready",
  requireRole("super_admin", "admin", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) throw new ValidationError("Invalid appointment ID");
    res.json(await readyAppointment(req, id));
  }),
);

router.post("/appointments/:appointmentId/consult",
  requireRole("super_admin", "admin", "doctor"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) throw new ValidationError("Invalid appointment ID");
    const { appt } = await transitionAppointment(req, id, "consult", { consultationStartedAt: new Date() });
    await logAudit(req, "CONSULTATION_START", "appointment", appt.id);
    res.json(appt);
  }),
);

router.post("/appointments/:appointmentId/diagnostics",
  requireRole("super_admin", "admin", "doctor"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) throw new ValidationError("Invalid appointment ID");
    const { appt } = await transitionAppointment(req, id, "diagnostics");
    await logAudit(req, "DIAGNOSTICS_REQUESTED", "appointment", appt.id);
    res.json(appt);
  }),
);

router.post("/appointments/:appointmentId/reconsult",
  requireRole("super_admin", "admin", "doctor"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) throw new ValidationError("Invalid appointment ID");
    const { appt } = await transitionAppointment(req, id, "reconsult");
    await logAudit(req, "RECONSULT", "appointment", appt.id);
    res.json(appt);
  }),
);

router.post("/appointments/:appointmentId/payment",
  requireRole("super_admin", "admin", "doctor", "nurse", "front_desk"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) throw new ValidationError("Invalid appointment ID");
    const { appt } = await transitionAppointment(req, id, "payment");
    await logAudit(req, "PENDING_PAYMENT", "appointment", appt.id);
    res.json(appt);
  }),
);

router.post("/appointments/:appointmentId/complete",
  requireRole("super_admin", "admin", "doctor", "front_desk"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) throw new ValidationError("Invalid appointment ID");
    const { appt } = await transitionAppointment(req, id, "complete");
    await logAudit(req, "COMPLETE", "appointment", appt.id);
    res.json(appt);
  }),
);

// Manual no-show: front desk marks a scheduled patient who didn't arrive, without
// waiting on the hourly cron. Same state-machine transition the cron uses, but
// with request context so it gets a normal audit row + real-time SSE refresh.
router.post("/appointments/:appointmentId/no-show",
  requireRole("super_admin", "admin", "front_desk"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) throw new ValidationError("Invalid appointment ID");
    const { appt } = await transitionAppointment(req, id, "no_show");
    await logAudit(req, "NO_SHOW", "appointment", appt.id);
    res.json(appt);
  }),
);

router.get("/appointments/:appointmentId/discharge", asyncHandler(async (req: AuthRequest, res) => {
  const id = safeParseInt(req.params.appointmentId);
  if (!id) throw new ValidationError("Invalid appointment ID");
  res.json(await getDischarge(req, id));
}));

export default router;
