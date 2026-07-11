import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../../middlewares/auth";
import { asyncHandler } from "../../middlewares/asyncHandler";
import { validate } from "../../middlewares/validate";
import { RecordInvoicePaymentBody } from "@workspace/api-zod";
import { ValidationError } from "../../services/errors";
import { safeParseInt } from "../../lib/validators";
import { recordPayment, listPayments } from "./payments.service";

const router = Router();
router.use(requireAuth);

// View ledger + derived balance: same read audience as invoice view.
router.get("/billing/invoices/:invoiceId/payments",
  requireRole("super_admin", "admin", "front_desk", "billing_manager"),
  asyncHandler(async (req: AuthRequest, res) => {
    const invoiceId = safeParseInt(req.params.invoiceId);
    if (!invoiceId) throw new ValidationError("Invalid invoice ID");
    res.json(await listPayments(req, invoiceId));
  }),
);

// Record a payment / refund: billing_manager, admin, super_admin — NOT front_desk
// (Separation of Duties, mirroring the /pay route).
router.post("/billing/invoices/:invoiceId/payments",
  requireRole("super_admin", "admin", "billing_manager"),
  validate(RecordInvoicePaymentBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const invoiceId = safeParseInt(req.params.invoiceId);
    if (!invoiceId) throw new ValidationError("Invalid invoice ID");
    res.status(201).json(await recordPayment(req, invoiceId, req.body));
  }),
);

export default router;
