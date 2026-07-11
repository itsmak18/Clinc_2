import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../../middlewares/auth";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { validate } from "../../middlewares/validate";
import { CreateUltrasoundRecordBody, UpdateUltrasoundRecordBody } from "@workspace/api-zod";
import { ValidationError } from "../../services/errors";
import { safeParseInt, safeParseUUID } from "../../lib/validators";
import { listUltrasounds, createUltrasound, getUltrasound, updateUltrasound } from "./ultrasound.service";
import { uploadSingleImage } from "../../middlewares/imaging-upload";
import { uploadAttachment, streamAttachment, deleteAttachment } from "./imaging-attachments.service";

const router = Router();
router.use(requireAuth);
router.use("/ultrasound", requireRole("super_admin", "admin", "doctor", "nurse", "xray_staff"));

router.get("/ultrasound", asyncHandler(async (req: AuthRequest, res) => {
  const { status, clearanceStatus, patientId, limit, cursor } = req.query as Record<string, string | undefined>;
  const result = await listUltrasounds(req, { status, clearanceStatus, patientId, limit, cursor });
  res.json(result.data);
}));

router.post("/ultrasound", validate(CreateUltrasoundRecordBody), asyncHandler(async (req: AuthRequest, res) => {
  res.status(201).json(await createUltrasound(req, req.body));
}));

router.get("/ultrasound/:ultrasoundId",
  requireRole("super_admin", "admin", "doctor", "nurse", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.ultrasoundId);
    if (!id) throw new ValidationError("Invalid ultrasound ID");
    res.json(await getUltrasound(req, id));
  }),
);

router.patch("/ultrasound/:ultrasoundId",
  requireRole("super_admin", "admin", "xray_staff"),
  validate(UpdateUltrasoundRecordBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.ultrasoundId);
    if (!id) throw new ValidationError("Invalid ultrasound ID");
    res.json(await updateUltrasound(req, id, req.body));
  }),
);

// ── Image attachments (upload to / download from the server) ─────────────────
router.post("/ultrasound/:ultrasoundId/images",
  requireRole("super_admin", "admin", "xray_staff"),
  uploadSingleImage("file"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.ultrasoundId);
    if (!id) throw new ValidationError("Invalid ultrasound ID");
    const att = await uploadAttachment(req, "ultrasound", id, (req as any).file, req.body?.caption);
    res.status(201).json(att);
  }),
);

router.get("/ultrasound/:ultrasoundId/images/:attId",
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.ultrasoundId);
    if (!id) throw new ValidationError("Invalid ultrasound ID");
    const attId = safeParseUUID(req.params.attId);
    if (!attId) throw new ValidationError("Invalid image ID");
    const { bytes, mimeType, fileName } = await streamAttachment(req, "ultrasound", id, attId);
    const disposition = req.query.download !== undefined ? "attachment" : "inline";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `${disposition}; filename="${encodeURIComponent(fileName)}"`);
    res.send(bytes);
  }),
);

router.delete("/ultrasound/:ultrasoundId/images/:attId",
  requireRole("super_admin", "admin", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.ultrasoundId);
    if (!id) throw new ValidationError("Invalid ultrasound ID");
    const attId = safeParseUUID(req.params.attId);
    if (!attId) throw new ValidationError("Invalid image ID");
    await deleteAttachment(req, "ultrasound", id, attId);
    res.status(204).end();
  }),
);

export default router;
