import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../../middlewares/auth";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { validate } from "../../middlewares/validate";
import { CreateServiceBody, UpdateServiceBody } from "@workspace/api-zod";
import { ValidationError } from "../../services/errors";
import { safeParseInt } from "../../lib/validators";
import {
  listServices, createService, updateService, deleteService, seedDefaultServices,
} from "./services-catalog.service";

const router = Router();
router.use(requireAuth);

// Read: billing-adjacent roles need to see prices.
router.get("/services-catalog",
  requireRole("super_admin", "admin", "billing_manager", "front_desk"),
  asyncHandler(async (req: AuthRequest, res) => {
    const { category, includeInactive, cursor, limit } = req.query as Record<string, string | undefined>;
    res.json(await listServices(req, { category, includeInactive: includeInactive === "true", cursor, limit }));
  }),
);

// Populate a starter set of common services (price 0) — admins only.
router.post("/services-catalog/seed-defaults",
  requireRole("super_admin", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json(await seedDefaultServices(req));
  }),
);

// Manage prices: admins only.
router.post("/services-catalog",
  requireRole("super_admin", "admin"),
  validate(CreateServiceBody),
  asyncHandler(async (req: AuthRequest, res) => {
    res.status(201).json(await createService(req, req.body));
  }),
);

router.patch("/services-catalog/:serviceId",
  requireRole("super_admin", "admin"),
  validate(UpdateServiceBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const serviceId = safeParseInt(req.params.serviceId);
    if (!serviceId) throw new ValidationError("Invalid service ID");
    res.json(await updateService(req, serviceId, req.body));
  }),
);

router.delete("/services-catalog/:serviceId",
  requireRole("super_admin", "admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    const serviceId = safeParseInt(req.params.serviceId);
    if (!serviceId) throw new ValidationError("Invalid service ID");
    await deleteService(req, serviceId);
    res.json({ success: true });
  }),
);

export default router;
