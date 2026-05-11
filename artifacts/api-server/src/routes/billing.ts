import { Router } from "express";
import { db } from "@workspace/db";
import { invoicesTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, gte, lte, and, count, sum, sql } from "drizzle-orm";
import { getTimezoneOffset } from "date-fns-tz";
import { z } from "zod/v4";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit, logRead } from "../lib/audit";
import { safeParseInt } from "../lib/validators";

const router = Router();
router.use(requireAuth);
router.use("/billing", requireRole("super_admin", "admin", "front_desk"));

const billingItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().int().positive(),
  unitPrice: z.number().nonnegative(),
}).strict();

async function generateInvoiceNumber(): Promise<string> {
  const [{ nextval }] = await db.execute(sql`SELECT nextval('invoice_seq') as nextval`) as any;
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `INV-${ym}-${String(nextval).padStart(6, "0")}`;
}

router.get("/billing/invoices", async (req, res) => {
  const { status, patientId } = req.query;

  const conditions: any[] = [isNull(invoicesTable.deletedAt)];
  if (status) conditions.push(eq(invoicesTable.status, status as any));
  if (patientId) {
    const pid = safeParseInt(patientId as string);
    if (!pid) { res.status(400).json({ error: "Invalid patientId" }); return; }
    conditions.push(eq(invoicesTable.patientId, pid));
  }

  const rows = await db.select({
    id: invoicesTable.id,
    invoiceNumber: invoicesTable.invoiceNumber,
    patientId: invoicesTable.patientId,
    createdById: invoicesTable.createdById,
    items: invoicesTable.items,
    subtotal: invoicesTable.subtotal,
    discount: invoicesTable.discount,
    total: invoicesTable.total,
    status: invoicesTable.status,
    paidAt: invoicesTable.paidAt,
    notes: invoicesTable.notes,
    createdAt: invoicesTable.createdAt,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName },
  }).from(invoicesTable)
    .leftJoin(patientsTable, eq(invoicesTable.patientId, patientsTable.id))
    .where(and(...conditions))
    .orderBy(desc(invoicesTable.createdAt));

  res.json(rows);
});

router.post("/billing/invoices", requireRole("super_admin", "admin", "front_desk"), async (req: AuthRequest, res) => {
  const { patientId, createdById, items, discount = 0, notes } = req.body;
  if (!patientId || !createdById || !items?.length) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const parsedItems = z.array(billingItemSchema).safeParse(items);
  if (!parsedItems.success) {
    res.status(400).json({ error: "Invalid items format", details: parsedItems.error.flatten() });
    return;
  }
  const subtotal = parsedItems.data.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const total = subtotal - discount;
  const invoiceNumber = await generateInvoiceNumber();
  const [invoice] = await db.insert(invoicesTable).values({
    invoiceNumber, patientId, createdById, items: parsedItems.data, subtotal: String(subtotal), discount: String(discount), total: String(total), notes,
  }).returning();
  await logAudit(req, "CREATE", "invoice", invoice.id);
  res.status(201).json(invoice);
});

router.get("/billing/invoices/:invoiceId",
  requireRole("super_admin", "admin", "front_desk"),
  async (req: AuthRequest, res) => {
    const invoiceId = safeParseInt(req.params.invoiceId);
    if (!invoiceId) { res.status(400).json({ error: "Invalid invoice ID" }); return; }
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    if (!invoice) { res.status(404).json({ error: "Not found" }); return; }
    void logRead(req, "invoice", invoiceId);
    res.json(invoice);
  }
);

router.patch("/billing/invoices/:invoiceId", requireRole("super_admin", "admin", "front_desk"), async (req: AuthRequest, res) => {
  const invoiceId = safeParseInt(req.params.invoiceId);
  if (!invoiceId) { res.status(400).json({ error: "Invalid invoice ID" }); return; }
  const { status, notes } = req.body;
  const [invoice] = await db.update(invoicesTable)
    .set({ status, notes, updatedAt: new Date() })
    .where(eq(invoicesTable.id, invoiceId))
    .returning();
  await logAudit(req, "UPDATE", "invoice", invoice.id);
  res.json(invoice);
});

router.post("/billing/invoices/:invoiceId/pay", requireRole("super_admin", "admin", "front_desk"), async (req: AuthRequest, res) => {
  const { amountReceived } = req.body;
  const invoiceId = safeParseInt(req.params.invoiceId);
  if (!invoiceId) { res.status(400).json({ error: "Invalid invoice ID" }); return; }

  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }

  // Guard: only pending invoices can be paid
  if (invoice.status !== "pending") {
    res.status(409).json({
      error: `Invoice is already ${invoice.status}. Cannot process payment.`,
      invoiceStatus: invoice.status,
    });
    return;
  }

  // Guard: amount received must cover the total
  if (amountReceived !== undefined && parseFloat(amountReceived) < parseFloat(String(invoice.total))) {
    res.status(400).json({
      error: `Amount received (${amountReceived}) is less than invoice total (${invoice.total}).`,
    });
    return;
  }

  // Atomic update: WHERE status='pending' prevents race-condition double payments (H-06)
  const [updated] = await db.update(invoicesTable)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(invoicesTable.id, invoiceId),
      eq(invoicesTable.status, "pending") // atomic guard
    ))
    .returning();

  if (!updated) {
    // Concurrent request already paid this invoice
    res.status(409).json({ error: "Invoice was already paid by a concurrent request." });
    return;
  }

  await logAudit(req, "PAY", "invoice", invoiceId, { amountReceived });
  res.json(updated);
});

router.get("/billing/daily-summary", requireRole("super_admin", "admin"), async (req, res) => {
  const dateStr = (req.query.date as string) || new Date().toISOString().split("T")[0];
  const CLINIC_TZ = process.env.CLINIC_TZ ?? "Europe/Istanbul";
  const start = new Date(`${dateStr}T00:00:00`);
  start.setTime(start.getTime() - getTimezoneOffset(CLINIC_TZ, start));
  const end = new Date(`${dateStr}T23:59:59.999`);
  end.setTime(end.getTime() - getTimezoneOffset(CLINIC_TZ, end));

  const invoices = await db.select().from(invoicesTable)
    .where(and(isNull(invoicesTable.deletedAt), gte(invoicesTable.createdAt, start), lte(invoicesTable.createdAt, end)));

  const totalRevenue = invoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(String(i.total)), 0);
  const totalInvoices = invoices.length;
  const paidInvoices = invoices.filter(i => i.status === "paid").length;
  const pendingInvoices = invoices.filter(i => i.status === "pending").length;

  res.json({ totalRevenue, totalInvoices, paidInvoices, pendingInvoices });
});

export default router;
