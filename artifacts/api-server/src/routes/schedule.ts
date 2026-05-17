import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { safeParseInt } from "../lib/validators";
import {
  listDoctorsWithTemplates,
  getDoctorSchedule,
  getDoctorAvailability,
  getWeekView,
  upsertWeeklyBlock,
  setWeeklyBlockStatus,
  deleteWeeklyBlock,
  upsertOverride,
  deleteOverride,
} from "../services/schedule.service";

const router = Router();
router.use(requireAuth);

const READ_ROLES = ["super_admin", "admin", "front_desk", "nurse", "doctor"] as const;
const WRITE_ROLES = ["super_admin", "admin"] as const;

router.get(
  "/schedule/doctors",
  requireRole(...READ_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json(await listDoctorsWithTemplates(req));
  }),
);

router.get(
  "/schedule/doctor/:id",
  requireRole(...READ_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }
    res.json(await getDoctorSchedule(req, doctorId));
  }),
);

router.get(
  "/schedule/availability/:id",
  requireRole(...READ_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }
    const dateStr = req.query.date as string | undefined;
    res.json(await getDoctorAvailability(req, doctorId, dateStr ?? ""));
  }),
);

router.get(
  "/schedule/week",
  requireRole(...READ_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.query.doctorId as string);
    if (!doctorId) { res.status(400).json({ error: "doctorId required" }); return; }
    const weekStartStr = req.query.weekStart as string | undefined;
    res.json(await getWeekView(req, doctorId, weekStartStr ?? ""));
  }),
);

router.post(
  "/schedule/doctor/:id/weekly",
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }
    const row = await upsertWeeklyBlock(req, doctorId, req.body);
    res.status(201).json(row);
  }),
);

router.patch(
  "/schedule/doctor/:id/weekly/:day/status",
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }
    res.json(await setWeeklyBlockStatus(req, doctorId, String(req.params.day), String(req.body.status)));
  }),
);

router.delete(
  "/schedule/doctor/:id/weekly/:day",
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }
    await deleteWeeklyBlock(req, doctorId, String(req.params.day));
    res.json({ success: true });
  }),
);

router.post(
  "/schedule/doctor/:id/override",
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }
    const row = await upsertOverride(req, doctorId, req.body);
    res.status(201).json(row);
  }),
);

router.delete(
  "/schedule/doctor/:id/override/:date",
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }
    await deleteOverride(req, doctorId, String(req.params.date));
    res.json({ success: true });
  }),
);

export default router;
