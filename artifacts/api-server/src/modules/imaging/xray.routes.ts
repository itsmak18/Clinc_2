import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../../middlewares/auth";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { validate } from "../../middlewares/validate";
import { CreateXrayRecordBody, UpdateXrayRecordBody } from "@workspace/api-zod";
import { ValidationError } from "../../services/errors";
import { safeParseInt, safeParseUUID } from "../../lib/validators";
import { listXrays, createXray, getXray, updateXray } from "./xray.service";
import { uploadSingleImage } from "../../middlewares/imaging-upload";
import { uploadAttachment, streamAttachment, deleteAttachment } from "./imaging-attachments.service";

const router = Router();
router.use(requireAuth);
router.use("/xray", requireRole("super_admin", "admin", "doctor", "nurse", "xray_staff"));

router.get("/xray", asyncHandler(async (req: AuthRequest, res) => {
  const { status, clearanceStatus, patientId, limit, cursor } = req.query as Record<string, string | undefined>;
  const result = await listXrays(req, { status, clearanceStatus, patientId, limit, cursor });
  res.json(result.data);
}));

router.post("/xray", validate(CreateXrayRecordBody), asyncHandler(async (req: AuthRequest, res) => {
  res.status(201).json(await createXray(req, req.body));
}));

router.get("/xray/:xrayId",
  requireRole("super_admin", "admin", "doctor", "nurse", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const xrayId = safeParseInt(req.params.xrayId);
    if (!xrayId) throw new ValidationError("Invalid xray ID");
    res.json(await getXray(req, xrayId));
  }),
);

router.patch("/xray/:xrayId",
  requireRole("super_admin", "admin", "xray_staff"),
  validate(UpdateXrayRecordBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const xrayId = safeParseInt(req.params.xrayId);
    if (!xrayId) throw new ValidationError("Invalid xray ID");
    res.json(await updateXray(req, xrayId, req.body));
  }),
);

// ── Image attachments (upload to / download from the server) ─────────────────
router.post("/xray/:xrayId/images",
  requireRole("super_admin", "admin", "xray_staff"),
  uploadSingleImage("file"),
  asyncHandler(async (req: AuthRequest, res) => {
    const xrayId = safeParseInt(req.params.xrayId);
    if (!xrayId) throw new ValidationError("Invalid xray ID");
    const att = await uploadAttachment(req, "xray", xrayId, (req as any).file, req.body?.caption);
    res.status(201).json(att);
  }),
);

router.get("/xray/:xrayId/images/:attId",
  asyncHandler(async (req: AuthRequest, res) => {
    const xrayId = safeParseInt(req.params.xrayId);
    if (!xrayId) throw new ValidationError("Invalid xray ID");
    const attId = safeParseUUID(req.params.attId);
    if (!attId) throw new ValidationError("Invalid image ID");
    const { bytes, mimeType, fileName } = await streamAttachment(req, "xray", xrayId, attId);
    const disposition = req.query.download !== undefined ? "attachment" : "inline";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Disposition", `${disposition}; filename="${encodeURIComponent(fileName)}"`);
    res.send(bytes);
  }),
);

router.delete("/xray/:xrayId/images/:attId",
  requireRole("super_admin", "admin", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const xrayId = safeParseInt(req.params.xrayId);
    if (!xrayId) throw new ValidationError("Invalid xray ID");
    const attId = safeParseUUID(req.params.attId);
    if (!attId) throw new ValidationError("Invalid image ID");
    await deleteAttachment(req, "xray", xrayId, attId);
    res.status(204).end();
  }),
);

export default router;
