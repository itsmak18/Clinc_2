import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { safeParseInt } from "../lib/validators";
import { logAudit } from "../lib/audit";
import {
  listAppointments, createAppointment, getAppointmentFlow, getTodayAppointments,
  getAppointment, patchAppointment, cancelAppointment, checkinAppointment,
  readyAppointment, transitionAppointment, getDischarge,
} from "../services/appointments.service";

const router = Router();
router.use(requireAuth);
router.use("/appointments", requireRole("super_admin", "admin", "doctor", "nurse", "front_desk", "lab_staff", "xray_staff"));

router.get("/appointments", asyncHandler(async (req: AuthRequest, res) => {
  const { status, date, doctorId, patientId, limit, offset } = req.query as Record<string, string | undefined>;
  res.json(await listAppointments(req, { status, date, doctorId, patientId, limit, offset }));
}));

router.post("/appointments", asyncHandler(async (req: AuthRequest, res) => {
  res.status(201).json(await createAppointment(req, req.body));
}));

router.get("/appointments/flow",
  requireRole("super_admin", "admin", "doctor", "nurse", "front_desk"),
  asyncHandler(async (_req, res) => {
    res.json(await getAppointmentFlow());
  }),
);

router.get("/appointments/today", asyncHandler(async (_req, res) => {
  res.json(await getTodayAppointments());
}));

router.get("/appointments/:appointmentId", asyncHandler(async (req, res) => {
  const id = safeParseInt(req.params.appointmentId);
  if (!id) { res.status(400).json({ error: "Invalid appointment ID" }); return; }
  res.json(await getAppointment(id));
}));

router.patch("/appointments/:appointmentId",
  requireRole("super_admin", "admin", "front_desk", "doctor", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) { res.status(400).json({ error: "Invalid appointment ID" }); return; }
    res.json(await patchAppointment(req, id, req.body));
  }),
);

router.delete("/appointments/:appointmentId",
  requireRole("super_admin", "admin", "front_desk"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) { res.status(400).json({ error: "Invalid appointment ID" }); return; }
    await cancelAppointment(req, id, req.body?.cancellationReason);
    res.json({ success: true });
  }),
);

router.post("/appointments/:appointmentId/checkin",
  requireRole("super_admin", "admin", "front_desk", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) { res.status(400).json({ error: "Invalid appointment ID" }); return; }
    res.json(await checkinAppointment(req, id));
  }),
);

router.post("/appointments/:appointmentId/triage",
  requireRole("super_admin", "admin", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) { res.status(400).json({ error: "Invalid appointment ID" }); return; }
    const { appt } = await transitionAppointment(req, id, "triage", { triageStartedAt: new Date() });
    await logAudit(req, "TRIAGE_START", "appointment", appt.id);
    res.json(appt);
  }),
);

router.post("/appointments/:appointmentId/ready",
  requireRole("super_admin", "admin", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) { res.status(400).json({ error: "Invalid appointment ID" }); return; }
    res.json(await readyAppointment(req, id));
  }),
);

router.post("/appointments/:appointmentId/consult",
  requireRole("super_admin", "admin", "doctor"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) { res.status(400).json({ error: "Invalid appointment ID" }); return; }
    const { appt } = await transitionAppointment(req, id, "consult", { consultationStartedAt: new Date() });
    await logAudit(req, "CONSULTATION_START", "appointment", appt.id);
    res.json(appt);
  }),
);

router.post("/appointments/:appointmentId/diagnostics",
  requireRole("super_admin", "admin", "doctor"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) { res.status(400).json({ error: "Invalid appointment ID" }); return; }
    const { appt } = await transitionAppointment(req, id, "diagnostics");
    await logAudit(req, "DIAGNOSTICS_REQUESTED", "appointment", appt.id);
    res.json(appt);
  }),
);

router.post("/appointments/:appointmentId/payment",
  requireRole("super_admin", "admin", "doctor", "nurse", "front_desk"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) { res.status(400).json({ error: "Invalid appointment ID" }); return; }
    const { appt } = await transitionAppointment(req, id, "payment");
    await logAudit(req, "PENDING_PAYMENT", "appointment", appt.id);
    res.json(appt);
  }),
);

router.post("/appointments/:appointmentId/complete",
  requireRole("super_admin", "admin", "front_desk"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.appointmentId);
    if (!id) { res.status(400).json({ error: "Invalid appointment ID" }); return; }
    const { appt } = await transitionAppointment(req, id, "complete");
    await logAudit(req, "COMPLETE", "appointment", appt.id);
    res.json(appt);
  }),
);

router.get("/appointments/:appointmentId/discharge", asyncHandler(async (req, res) => {
  const id = safeParseInt(req.params.appointmentId);
  if (!id) { res.status(400).json({ error: "Invalid appointment ID" }); return; }
  res.json(await getDischarge(id));
}));

export default router;
