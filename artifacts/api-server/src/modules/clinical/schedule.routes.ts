import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../../middlewares/auth";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { validate } from "../../middlewares/validate";
import { UpsertWeeklyBlockBody, UpdateWeeklyBlockStatusBody, UpsertScheduleOverrideBody } from "@workspace/api-zod";
import { ValidationError } from "../../services/errors";
import { safeParseInt } from "../../lib/validators";
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
} from "./schedule.service";

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
    if (!doctorId) throw new ValidationError("Invalid doctor id");
    res.json(await getDoctorSchedule(req, doctorId));
  }),
);

router.get(
  "/schedule/availability/:id",
  requireRole(...READ_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) throw new ValidationError("Invalid doctor id");
    const dateStr = req.query.date as string | undefined;
    res.json(await getDoctorAvailability(req, doctorId, dateStr ?? ""));
  }),
);

router.get(
  "/schedule/week",
  requireRole(...READ_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.query.doctorId as string);
    if (!doctorId) throw new ValidationError("doctorId required");
    const weekStartStr = req.query.weekStart as string | undefined;
    res.json(await getWeekView(req, doctorId, weekStartStr ?? ""));
  }),
);

router.post(
  "/schedule/doctor/:id/weekly",
  requireRole(...WRITE_ROLES),
  validate(UpsertWeeklyBlockBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) throw new ValidationError("Invalid doctor id");
    const row = await upsertWeeklyBlock(req, doctorId, req.body);
    res.status(201).json(row);
  }),
);

router.patch(
  "/schedule/doctor/:id/weekly/:day/status",
  requireRole(...WRITE_ROLES),
  validate(UpdateWeeklyBlockStatusBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) throw new ValidationError("Invalid doctor id");
    res.json(await setWeeklyBlockStatus(req, doctorId, String(req.params.day), String(req.body.status)));
  }),
);

router.delete(
  "/schedule/doctor/:id/weekly/:day",
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) throw new ValidationError("Invalid doctor id");
    await deleteWeeklyBlock(req, doctorId, String(req.params.day));
    res.json({ success: true });
  }),
);

router.post(
  "/schedule/doctor/:id/override",
  requireRole(...WRITE_ROLES),
  validate(UpsertScheduleOverrideBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) throw new ValidationError("Invalid doctor id");
    const row = await upsertOverride(req, doctorId, req.body);
    res.status(201).json(row);
  }),
);

router.delete(
  "/schedule/doctor/:id/override/:date",
  requireRole(...WRITE_ROLES),
  asyncHandler(async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) throw new ValidationError("Invalid doctor id");
    await deleteOverride(req, doctorId, String(req.params.date));
    res.json({ success: true });
  }),
);

export default router;
