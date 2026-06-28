import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { validate } from "../middlewares/validate";
import { CreateOperationBody, UpdateOperationBody } from "@workspace/api-zod";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import { listOperations, getOperation, createOperation, updateOperation } from "../services/operations.service";

const router = Router();
router.use(requireAuth);

router.get(
  "/operations",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { status, cursor, limit } = req.query as Record<string, string | undefined>;
    res.json(await listOperations(req, { status, cursor, limit }));
  }),
);

router.post(
  "/operations",
  requireRole("super_admin", "admin", "doctor"),
  validate(CreateOperationBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const operation = await createOperation(req, req.body);
    res.status(201).json(operation);
  }),
);

router.get(
  "/operations/:operationId",
  requireRole("super_admin", "admin", "doctor", "nurse"),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.operationId);
    if (!id) throw new ValidationError("Invalid operation ID");
    res.json(await getOperation(req, id));
  }),
);

router.patch(
  "/operations/:operationId",
  requireRole("super_admin", "admin", "doctor"),
  validate(UpdateOperationBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const id = safeParseInt(req.params.operationId);
    if (!id) throw new ValidationError("Invalid operation ID");
    res.json(await updateOperation(req, id, req.body));
  }),
);

export default router;
