// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { invoicesTable, patientsTable, invoiceItemsTable } from "@workspace/db";
import { eq, isNull, desc, gte, lte, and, sql, inArray } from "drizzle-orm";
import { getTimezoneOffset } from "date-fns-tz";
import { logAudit, logRead, auditSnapshot } from "../lib/audit";
import { itemsSchema } from "../lib/jsonb-schemas";
import { NotFoundError, ValidationError, ConflictError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

async function generateInvoiceNumber(): Promise<string> {
  const [{ nextval }] = await db.execute(sql`SELECT nextval('invoice_seq') as nextval`) as any;
  const d = new Date();
  const ym = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
  return `INV-${ym}-${String(nextval).padStart(6, "0")}`;
}

async function fetchInvoiceItems(invoiceId: number) {
  const rows = await db.select({
    description: invoiceItemsTable.description,
    quantity:    invoiceItemsTable.quantity,
    unitPrice:   invoiceItemsTable.unitPrice,
  }).from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoiceId));
  return rows.map(r => ({ description: r.description, quantity: r.quantity, unitPrice: parseFloat(String(r.unitPrice)) }));
}

async function fetchInvoiceItemsBatch(invoiceIds: number[]) {
  const map = new Map<number, { description: string; quantity: number; unitPrice: number }[]>();
  if (!invoiceIds.length) return map;
  const rows = await db.select({
    invoiceId:   invoiceItemsTable.invoiceId,
    description: invoiceItemsTable.description,
    quantity:    invoiceItemsTable.quantity,
    unitPrice:   invoiceItemsTable.unitPrice,
  }).from(invoiceItemsTable).where(inArray(invoiceItemsTable.invoiceId, invoiceIds));
  for (const r of rows) {
    const arr = map.get(r.invoiceId) ?? [];
    arr.push({ description: r.description, quantity: r.quantity, unitPrice: parseFloat(String(r.unitPrice)) });
    map.set(r.invoiceId, arr);
  }
  return map;
}

export async function listInvoices(req: AuthRequest, params: { status?: string; patientId?: string }) {
  const conditions: any[] = [isNull(invoicesTable.deletedAt), eq(invoicesTable.clinicId, req.user!.clinicId)];

  if (params.status) conditions.push(eq(invoicesTable.status, params.status as any));
  if (params.patientId) {
    const pid = parseInt(params.patientId);
    if (!isNaN(pid)) conditions.push(eq(invoicesTable.patientId, pid));
  }

  const rows = await runInTenantContext(req.user!, async (tx) =>
    tx.select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      patientId: invoicesTable.patientId,
      createdById: invoicesTable.createdById,
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
      .orderBy(desc(invoicesTable.createdAt)),
  );

  const itemsMap = await fetchInvoiceItemsBatch(rows.map(r => r.id));
  void logRead(req, "invoice", undefined);
  return rows.map(r => ({ ...r, items: itemsMap.get(r.id) ?? [] }));
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
  if (!patient) throw new NotFoundError("patient", String(data.patientId));

  const parsedItems = itemsSchema.safeParse(data.items);
  if (!parsedItems.success) {
    throw new ValidationError("Invalid items format");
  }
  const subtotal = parsedItems.data.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const discount = data.discount ?? 0;
  const total = subtotal - discount;
  const invoiceNumber = await generateInvoiceNumber();

  const [invoice] = await db.insert(invoicesTable).values({
    clinicId: req.user!.clinicId,
    invoiceNumber, patientId: data.patientId, createdById,
    subtotal: String(subtotal), discount: String(discount),
    total: String(total), notes: data.notes,
  }).returning();

  await db.insert(invoiceItemsTable).values(
    parsedItems.data.map(item => ({
      invoiceId: invoice.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: String(item.unitPrice),
    })),
  );

  await logAudit(req, "CREATE", "invoice", invoice.id);
  return { ...invoice, items: parsedItems.data };
}

export async function getInvoice(req: AuthRequest, invoiceId: number) {
  const invoice = await runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(invoicesTable.id, invoiceId), isNull(invoicesTable.deletedAt), eq(invoicesTable.clinicId, req.user!.clinicId)];
    const [row] = await tx.select().from(invoicesTable).where(and(...conditions));
    return row;
  });
  if (!invoice) throw new NotFoundError("invoice", invoiceId);
  const items = await fetchInvoiceItems(invoiceId);
  void logRead(req, "invoice", invoiceId);
  return { ...invoice, items };
}

export async function updateInvoice(req: AuthRequest, invoiceId: number, data: { notes?: string }) {
  const conditions: any[] = [eq(invoicesTable.id, invoiceId), isNull(invoicesTable.deletedAt), eq(invoicesTable.clinicId, req.user!.clinicId)];
  const [existing] = await db.select().from(invoicesTable).where(and(...conditions));
  if (!existing) throw new NotFoundError("invoice", invoiceId);
  if (existing.status === "cancelled") throw new ConflictError("Cannot edit a cancelled invoice.");

  const [invoice] = await db.update(invoicesTable)
    .set({ notes: data.notes, updatedAt: new Date() })
    .where(and(...conditions))
    .returning();
  await logAudit(req, "UPDATE", "invoice", invoiceId, { fields: ["notes"] }, auditSnapshot(existing), auditSnapshot(invoice));
  const items = await fetchInvoiceItems(invoiceId);
  return { ...invoice, items };
}

export async function cancelInvoice(req: AuthRequest, invoiceId: number, reason: string) {
  const conditions: any[] = [eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, req.user!.clinicId)];
  const [invoice] = await db.select().from(invoicesTable).where(and(...conditions));
  if (!invoice) throw new NotFoundError("invoice", invoiceId);
  if (invoice.status !== "pending") {
    throw new ConflictError(`Invoice is already ${invoice.status}. Cannot cancel.`);
  }

  const cancelConditions: any[] = [eq(invoicesTable.id, invoiceId), eq(invoicesTable.status, "pending")];

  const [updated] = await db.update(invoicesTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(...cancelConditions))
    .returning();

  if (!updated) throw new ConflictError("Invoice status changed by a concurrent request.");
  await logAudit(req, "INVOICE_CANCEL", "invoice", invoiceId, { reason });
  const items = await fetchInvoiceItems(invoiceId);
  return { ...updated, items };
}

export async function payInvoice(req: AuthRequest, invoiceId: number, amountReceived?: number) {
  const conditions: any[] = [eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, req.user!.clinicId)];
  const [invoice] = await db.select().from(invoicesTable).where(and(...conditions));
  if (!invoice) throw new NotFoundError("invoice", invoiceId);

  if (invoice.status !== "pending") {
    throw new ConflictError(`Invoice is already ${invoice.status}. Cannot process payment.`);
  }

  // Anti-fraud: reject if the invoice was created by the same user within the last 30 seconds
  const payerId = req.user?.userId;
  const ageMs = Date.now() - new Date(invoice.createdAt).getTime();
  if (payerId && invoice.createdById === payerId && ageMs < 30_000) {
    await logAudit(req, "INVOICE_PAY_FRAUD_GATE", "invoice", invoiceId, { ageMs });
    throw new ConflictError("Invoice was created too recently by the same user. Have a second staff member process payment.");
  }

  if (amountReceived !== undefined && amountReceived < parseFloat(String(invoice.total))) {
    throw new ValidationError(`Amount received (${amountReceived}) is less than invoice total (${invoice.total}).`);
  }

  const payConditions: any[] = [eq(invoicesTable.id, invoiceId), eq(invoicesTable.status, "pending")];

  const [updated] = await db.update(invoicesTable)
    .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
    .where(and(...payConditions))
    .returning();

  if (!updated) throw new ConflictError("Invoice was already paid by a concurrent request.");

  await logAudit(req, "PAY", "invoice", invoiceId, { amountReceived });
  const items = await fetchInvoiceItems(invoiceId);
  return { ...updated, items };
}

export async function getDailySummary(req: AuthRequest, dateStr?: string) {
  const date = dateStr || new Date().toISOString().split("T")[0];
  const CLINIC_TZ = process.env.CLINIC_TZ ?? "Europe/Istanbul";
  const start = new Date(`${date}T00:00:00`);
  start.setTime(start.getTime() - getTimezoneOffset(CLINIC_TZ, start));
  const end = new Date(`${date}T23:59:59.999`);
  end.setTime(end.getTime() - getTimezoneOffset(CLINIC_TZ, end));

  const conditions: any[] = [isNull(invoicesTable.deletedAt), gte(invoicesTable.createdAt, start), lte(invoicesTable.createdAt, end), eq(invoicesTable.clinicId, req.user!.clinicId)];

  const invoices = await db.select().from(invoicesTable).where(and(...conditions));

  void logRead(req, "invoice", undefined);
  return {
    totalRevenue:    invoices.filter(i => i.status === "paid").reduce((s, i) => s + parseFloat(String(i.total)), 0),
    totalInvoices:   invoices.length,
    paidInvoices:    invoices.filter(i => i.status === "paid").length,
    pendingInvoices: invoices.filter(i => i.status === "pending").length,
  };
}
