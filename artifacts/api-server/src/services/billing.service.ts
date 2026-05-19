import { db } from "@workspace/db";
import { invoicesTable, patientsTable } from "@workspace/db";
import { eq, isNull, desc, gte, lte, and, sql } from "drizzle-orm";
import { getTimezoneOffset } from "date-fns-tz";
import { logAudit, logRead } from "../lib/audit";
import { safeParseInt } from "../lib/validators";
import { itemsSchema } from "../lib/jsonb-schemas";
import { NotFoundError, ValidationError, ConflictError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

async function generateInvoiceNumber(): Promise<string> {
  const [{ nextval }] = await db.execute(sql`SELECT nextval('invoice_seq') as nextval`) as any;
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `INV-${ym}-${String(nextval).padStart(6, "0")}`;
}

export async function listInvoices(req: AuthRequest, params: { status?: string; patientId?: string }) {
  const conditions: any[] = [isNull(invoicesTable.deletedAt)];
  if (params.status) conditions.push(eq(invoicesTable.status, params.status as any));
  if (params.patientId) {
    const pid = safeParseInt(params.patientId);
    if (!pid) throw new ValidationError("Invalid patientId");
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

  void logRead(req, "invoice", undefined);
  return rows;
}

export async function createInvoice(
  req: AuthRequest,
  data: { patientId: number; items: unknown[]; discount?: number; notes?: string },
) {
  const createdById = req.user!.userId;
  if (!data.patientId || !data.items?.length) {
    throw new ValidationError("Missing required fields");
  }

  const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable)
    .where(and(eq(patientsTable.id, data.patientId), isNull(patientsTable.deletedAt)));
  if (!patient) throw new NotFoundError("patient", data.patientId);

  const parsedItems = itemsSchema.safeParse(data.items);
  if (!parsedItems.success) {
    throw new ValidationError("Invalid items format");
  }
  const subtotal = parsedItems.data.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const discount = data.discount ?? 0;
  const total = subtotal - discount;
  const invoiceNumber = await generateInvoiceNumber();

  const [invoice] = await db.insert(invoicesTable).values({
    invoiceNumber, patientId: data.patientId, createdById,
    items: parsedItems.data, subtotal: String(subtotal), discount: String(discount),
    total: String(total), notes: data.notes,
  }).returning();

  await logAudit(req, "CREATE", "invoice", invoice.id);
  return invoice;
}

export async function getInvoice(req: AuthRequest, invoiceId: number) {
  const [invoice] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, invoiceId), isNull(invoicesTable.deletedAt)));
  if (!invoice) throw new NotFoundError("invoice", invoiceId);
  void logRead(req, "invoice", invoiceId);
  return invoice;
}

export async function updateInvoice(req: AuthRequest, invoiceId: number, data: { notes?: string }) {
  const [existing] = await db.select().from(invoicesTable)
    .where(and(eq(invoicesTable.id, invoiceId), isNull(invoicesTable.deletedAt)));
  if (!existing) throw new NotFoundError("invoice", invoiceId);
  if (existing.status === "cancelled") throw new ConflictError("Cannot edit a cancelled invoice.");

  const [invoice] = await db.update(invoicesTable)
    .set({ notes: data.notes, updatedAt: new Date() })
    .where(eq(invoicesTable.id, invoiceId))
    .returning();
  await logAudit(req, "UPDATE", "invoice", invoiceId, { fields: ["notes"] });
  return invoice;
}

export async function cancelInvoice(req: AuthRequest, invoiceId: number, reason: string) {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!invoice) throw new NotFoundError("invoice", invoiceId);
  if (invoice.status !== "pending") {
    throw new ConflictError(`Invoice is already ${invoice.status}. Cannot cancel.`);
  }

  const [updated] = await db.update(invoicesTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.status, "pending")))
    .returning();

  if (!updated) throw new ConflictError("Invoice status changed by a concurrent request.");
  await logAudit(req, "INVOICE_CANCEL", "invoice", invoiceId, { reason });
  return updated;
}

export async function payInvoice(req: AuthRequest, invoiceId: number, amountReceived?: number) {
  const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!invoice) throw new NotFoundError("invoice", invoiceId);

  if (invoice.status !== "pending") {
    throw new ConflictError(`Invoice is already ${invoice.status}. Cannot process payment.`);
  }

  // Anti-fraud: reject if the invoice was created by the same user within the last 30 seconds
  const payerId = (req as any).user?.userId;
  const ageMs = Date.now() - new Date(invoice.createdAt).getTime();
  if (payerId && invoice.createdById === payerId && ageMs < 30_000) {
    await logAudit(req, "INVOICE_PAY_FRAUD_GATE", "invoice", invoiceId, { ageMs });
    throw new ConflictError("Invoice was created too recently by the same user. Have a second staff member process payment.");
  }

  if (amountReceived !== undefined && amountReceived < parseFloat(String(invoice.total))) {
    throw new ValidationError(`Amount received (${amountReceived}) is less than invoice total (${invoice.total}).`);
  }

  const [updated] = await db.update(invoicesTable)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.status, "pending")))
    .returning();

  if (!updated) throw new ConflictError("Invoice was already paid by a concurrent request.");

  await logAudit(req, "PAY", "invoice", invoiceId, { amountReceived });
  return updated;
}

export async function getDailySummary(req: AuthRequest, dateStr?: string) {
  const date = dateStr || new Date().toISOString().split("T")[0];
  const CLINIC_TZ = process.env.CLINIC_TZ ?? "Europe/Istanbul";
  const start = new Date(`${date}T00:00:00`);
  start.setTime(start.getTime() - getTimezoneOffset(CLINIC_TZ, start));
  const end = new Date(`${date}T23:59:59.999`);
  end.setTime(end.getTime() - getTimezoneOffset(CLINIC_TZ, end));

  const invoices = await db.select().from(invoicesTable)
    .where(and(isNull(invoicesTable.deletedAt), gte(invoicesTable.createdAt, start), lte(invoicesTable.createdAt, end)));

  void logRead(req, "invoice", undefined);
  return {
    totalRevenue:    invoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(String(i.total)), 0),
    totalInvoices:   invoices.length,
    paidInvoices:    invoices.filter(i => i.status === "paid").length,
    pendingInvoices: invoices.filter(i => i.status === "pending").length,
  };
}
