import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { validate } from "../middlewares/validate";
import { CreateInventoryItemBody, UpdateInventoryItemBody } from "@workspace/api-zod";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import {
  listInventory,
  createInventoryItem,
  getInventoryItem,
  updateInventoryItem,
} from "../services/inventory.service";

const router = Router();
router.use(requireAuth);

// Clinical staff can read inventory to check stock levels
// Only admins may add or update items
router.get(
  "/inventory",
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { search, category } = req.query as Record<string, string | undefined>;
    res.json(await listInventory(req, { search, category }));
  }),
);

router.post(
  "/inventory",
  requireRole("super_admin", "admin"),
  validate(CreateInventoryItemBody),
  asyncHandler(async (req: AuthRequest, res) => {
    res.status(201).json(await createInventoryItem(req, req.body));
  }),
);

router.get(
  "/inventory/:itemId",
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff", "xray_staff"),
  asyncHandler(async (req: AuthRequest, res) => {
    const itemId = safeParseInt(req.params.itemId);
    if (!itemId) throw new ValidationError("Invalid item ID");
    res.json(await getInventoryItem(req, itemId));
  }),
);

router.patch(
  "/inventory/:itemId",
  requireRole("super_admin", "admin"),
  validate(UpdateInventoryItemBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const itemId = safeParseInt(req.params.itemId);
    if (!itemId) throw new ValidationError("Invalid item ID");
    res.json(await updateInventoryItem(req, itemId, req.body));
  }),
);

export default router;
