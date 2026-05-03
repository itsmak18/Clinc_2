import { Router } from "express";
import { db } from "@workspace/db";
import { invoicesTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, gte, lte, and, count, sum } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(requireAuth);
router.use("/billing", requireRole("super_admin", "admin", "front_desk"));

function generateInvoiceNumber(): string {
  const d = new Date();
  return `INV-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}-${Date.now().toString().slice(-5)}`;
}

router.get("/billing/invoices", async (req, res) => {
  const { status, patientId } = req.query;
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
    .where(isNull(invoicesTable.deletedAt))
    .orderBy(desc(invoicesTable.createdAt));

  let results = rows;
  if (status) results = results.filter(r => r.status === status);
  if (patientId) results = results.filter(r => r.patientId === parseInt(patientId as string));
  res.json(results);
});

router.post("/billing/invoices", requireRole("super_admin", "admin", "front_desk"), async (req: AuthRequest, res) => {
  const { patientId, createdById, items, discount = 0, notes } = req.body;
  if (!patientId || !createdById || !items?.length) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const subtotal = (items as any[]).reduce((s: number, i: any) => s + (i.total || i.quantity * i.unitPrice), 0);
  const total = subtotal - discount;
  const invoiceNumber = generateInvoiceNumber();
  const [invoice] = await db.insert(invoicesTable).values({
    invoiceNumber, patientId, createdById, items, subtotal: String(subtotal), discount: String(discount), total: String(total), notes,
  }).returning();
  await logAudit(req, "CREATE", "invoice", invoice.id);
  res.status(201).json(invoice);
});

router.get("/billing/invoices/:invoiceId", async (req, res) => {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, parseInt(req.params.invoiceId as string)));
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }
  res.json(invoice);
});

router.patch("/billing/invoices/:invoiceId", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  const { status, notes } = req.body;
  const [invoice] = await db.update(invoicesTable)
    .set({ status, notes, updatedAt: new Date() })
    .where(eq(invoicesTable.id, parseInt(req.params.invoiceId as string)))
    .returning();
  await logAudit(req, "UPDATE", "invoice", invoice.id);
  res.json(invoice);
});

router.post("/billing/invoices/:invoiceId/pay", requireRole("super_admin", "admin", "front_desk"), async (req: AuthRequest, res) => {
  const { amountReceived } = req.body;
  const invoiceId = parseInt(req.params.invoiceId as string);
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!invoice) { res.status(404).json({ error: "Not found" }); return; }
  const [updated] = await db.update(invoicesTable)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(eq(invoicesTable.id, invoiceId))
    .returning();
  await logAudit(req, "PAY", "invoice", invoiceId, { amountReceived });
  res.json(updated);
});

router.get("/billing/summary/daily", async (req, res) => {
  const dateStr = (req.query.date as string) || new Date().toISOString().split("T")[0];
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(`${dateStr}T23:59:59.999Z`);

  const invoices = await db.select().from(invoicesTable)
    .where(and(isNull(invoicesTable.deletedAt), gte(invoicesTable.createdAt, start), lte(invoicesTable.createdAt, end)));

  const totalRevenue = invoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(String(i.total)), 0);
  const totalInvoices = invoices.length;
  const paidInvoices = invoices.filter(i => i.status === "paid").length;
  const pendingInvoices = invoices.filter(i => i.status === "pending").length;

  res.json({ totalRevenue, totalInvoices, paidInvoices, pendingInvoices });
});

export default router;
