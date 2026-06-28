import { Router } from "express";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { validate } from "../middlewares/validate";
import { CreateInvoiceBody, UpdateInvoiceBody, PayInvoiceBody } from "@workspace/api-zod";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import {
  listInvoices, createInvoice, getInvoice, updateInvoice, cancelInvoice, payInvoice, getDailySummary,
  getBillingReconciliation,
} from "../services/billing.service";

const router = Router();
router.use(requireAuth);

// List + view: front_desk, billing_manager, admin, super_admin
router.get("/billing/invoices", requireRole("super_admin", "admin", "front_desk", "billing_manager"), asyncHandler(async (req: AuthRequest, res) => {
  const { status, patientId } = req.query as Record<string, string | undefined>;
  res.json(await listInvoices(req, { status, patientId }));
}));

// Create invoice: front_desk, admin, super_admin (billing_manager does reconciliation, not creation)
router.post("/billing/invoices",
  requireRole("super_admin", "admin", "front_desk"),
  validate(CreateInvoiceBody),
  asyncHandler(async (req: AuthRequest, res) => {
    res.status(201).json(await createInvoice(req, req.body));
  }),
);

router.get("/billing/invoices/:invoiceId",
  requireRole("super_admin", "admin", "front_desk", "billing_manager"),
  asyncHandler(async (req: AuthRequest, res) => {
    const invoiceId = safeParseInt(req.params.invoiceId);
    if (!invoiceId) throw new ValidationError("Invalid invoice ID");
    res.json(await getInvoice(req, invoiceId));
  }),
);

// Update notes/non-status fields: front_desk, admin, super_admin
router.patch("/billing/invoices/:invoiceId",
  requireRole("super_admin", "admin", "front_desk"),
  validate(UpdateInvoiceBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const invoiceId = safeParseInt(req.params.invoiceId);
    if (!invoiceId) throw new ValidationError("Invalid invoice ID");
    res.json(await updateInvoice(req, invoiceId, req.body));
  }),
);

// Cancel invoice: billing_manager or admin/super_admin; requires reason ≥30 chars (enforced in service)
router.post("/billing/invoices/:invoiceId/cancel",
  requireRole("super_admin", "admin", "billing_manager"),
  asyncHandler(async (req: AuthRequest, res) => {
    const invoiceId = safeParseInt(req.params.invoiceId);
    if (!invoiceId) throw new ValidationError("Invalid invoice ID");
    res.json(await cancelInvoice(req, invoiceId, req.body?.reason));
  }),
);

// Pay invoice: billing_manager, admin, super_admin — NOT front_desk (SoD)
router.post("/billing/invoices/:invoiceId/pay",
  requireRole("super_admin", "admin", "billing_manager"),
  validate(PayInvoiceBody),
  asyncHandler(async (req: AuthRequest, res) => {
    const invoiceId = safeParseInt(req.params.invoiceId);
    if (!invoiceId) throw new ValidationError("Invalid invoice ID");
    res.json(await payInvoice(req, invoiceId, req.body?.amountReceived));
  }),
);

router.get("/billing/daily-summary",
  requireRole("super_admin", "admin", "billing_manager"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json(await getDailySummary(req, req.query.date as string | undefined));
  }),
);

// End-of-day reconciliation / Z-report — super_admin only.
router.get("/billing/reconciliation",
  requireRole("super_admin"),
  asyncHandler(async (req: AuthRequest, res) => {
    res.json(await getBillingReconciliation(req, req.query.date as string | undefined));
  }),
);

export default router;
