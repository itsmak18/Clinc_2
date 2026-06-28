import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { validate } from "../middlewares/validate";
import { CreateInventoryItemBody, UpdateInventoryItemBody, AdjustInventoryStockBody } from "@workspace/api-zod";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import {
  listInventory,
  createInventoryItem,
  getInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  adjustInventoryStock,
  listInventoryTransactions,
} from "../services/inventory.service";

const router = Router();
router.use(requireAuth);

// Clinical staff can read inventory to check stock levels
// Only admins may add or update items
router.get(
  "/inventory",
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff", "xray_staff", "pharmacist"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { search, category, cursor, limit } = req.query as Record<string, string | undefined>;
    res.json(await listInventory(req, { search, category, cursor, limit }));
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
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff", "xray_staff", "pharmacist"),
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

router.delete(
  "/inventory/:itemId",
  requireRole("super_admin", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const itemId = safeParseInt(req.params.itemId);
    if (!itemId) throw new ValidationError("Invalid item ID");
    await deleteInventoryItem(req, itemId);
    res.json({ success: true });
  }),
);

router.post(
  "/inventory/:itemId/adjust",
  requireRole("super_admin", "admin"),
  validate(AdjustInventoryStockBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const itemId = safeParseInt(req.params.itemId);
    if (!itemId) throw new ValidationError("Invalid item ID");
    res.json(await adjustInventoryStock(req, itemId, req.body));
  }),
);

router.get(
  "/inventory/:itemId/transactions",
  requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff", "xray_staff", "pharmacist"),
  asyncHandler(async (req: AuthRequest, res) => {
    const itemId = safeParseInt(req.params.itemId);
    if (!itemId) throw new ValidationError("Invalid item ID");
    res.json(await listInventoryTransactions(req, itemId));
  }),
);

export default router;
