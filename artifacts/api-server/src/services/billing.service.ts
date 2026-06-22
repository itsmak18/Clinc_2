// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { invoicesTable, patientsTable, invoiceItemsTable, clinicInvoiceCountersTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, gte, lte, and, or, sql, inArray } from "drizzle-orm";
import { dayBoundary, clinicDateString, getClinicTimezone } from "../lib/dateUtils";
import { logAudit, logRead, auditSnapshot } from "../lib/audit";
import { itemsSchema } from "../lib/jsonb-schemas";
import { NotFoundError, ValidationError, ConflictError } from "./errors";
import { autoAdvanceVisit } from "./appointments.service";
import type { AuthRequest } from "../middlewares/auth";

// Per-clinic atomic counter — avoids leaking cross-tenant invoice volume via
// a global sequence. UPDATE ... RETURNING is atomic; no SELECT FOR UPDATE needed.
async function generateInvoiceNumber(clinicId: number): Promise<string> {
  const [row] = await db
    .update(clinicInvoiceCountersTable)
    .set({ lastSeq: sql`${clinicInvoiceCountersTable.lastSeq} + 1` })
    .where(eq(clinicInvoiceCountersTable.clinicId, clinicId))
    .returning({ lastSeq: clinicInvoiceCountersTable.lastSeq });

  if (!row) {
    // First invoice for this clinic — insert the counter row and return seq 1.
    const [inserted] = await db
      .insert(clinicInvoiceCountersTable)
      .values({ clinicId, lastSeq: 1 })
      .onConflictDoUpdate({
        target: clinicInvoiceCountersTable.clinicId,
        set: { lastSeq: sql`${clinicInvoiceCountersTable.lastSeq} + 1` },
      })
      .returning({ lastSeq: clinicInvoiceCountersTable.lastSeq });
    const seq = inserted.lastSeq;
    const ym = formatYM();
    return `INV-${ym}-${String(seq).padStart(6, "0")}`;
  }

  const ym = formatYM();
  return `INV-${ym}-${String(row.lastSeq).padStart(6, "0")}`;
}

function formatYM(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

async function fetchInvoiceItems(invoiceId: number, clinicId: number) {
  const rows = await db.select({
    description: invoiceItemsTable.description,
    quantity:    invoiceItemsTable.quantity,
    unitPrice:   invoiceItemsTable.unitPrice,
  }).from(invoiceItemsTable).where(
    and(eq(invoiceItemsTable.invoiceId, invoiceId), eq(invoiceItemsTable.clinicId, clinicId)),
  );
  return rows.map(r => ({ description: r.description, quantity: r.quantity, unitPrice: parseFloat(String(r.unitPrice)) }));
}

async function fetchInvoiceItemsBatch(invoiceIds: number[], clinicId: number) {
  const map = new Map<number, { description: string; quantity: number; unitPrice: number }[]>();
  if (!invoiceIds.length) return map;
  const rows = await db.select({
    invoiceId:   invoiceItemsTable.invoiceId,
    description: invoiceItemsTable.description,
    quantity:    invoiceItemsTable.quantity,
    unitPrice:   invoiceItemsTable.unitPrice,
  }).from(invoiceItemsTable).where(
    and(inArray(invoiceItemsTable.invoiceId, invoiceIds), eq(invoiceItemsTable.clinicId, clinicId)),
  );
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

  // Front desk works the current day's cash: show today's invoices PLUS any
  // still-unpaid (pending) invoice from a prior day, so nothing payable gets
  // stranded. Older paid/cancelled invoices are hidden. billing_manager / admin
  // / super_admin keep the full history.
  if (req.user!.role === "front_desk") {
    const tz = getClinicTimezone(req);
    const { start, end } = dayBoundary(clinicDateString(tz), tz);
    conditions.push(or(
      and(gte(invoicesTable.createdAt, start), lte(invoicesTable.createdAt, end)),
      eq(invoicesTable.status, "pending"),
    ));
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

  const itemsMap = await fetchInvoiceItemsBatch(rows.map(r => r.id), req.user!.clinicId);
  void logRead(req, "invoice", undefined);
  return rows.map(r => ({ ...r, items: itemsMap.get(r.id) ?? [] }));
}

export async function createInvoice(
  req: AuthRequest,
  data: { patientId: number; items: unknown[]; discount?: number; notes?: string; markPaid?: boolean },
) {
  const createdById = req.user!.userId;
  // patientId + non-empty items are validated at the route by
  // validate(CreateInvoiceBody); item shape is guarded by itemsSchema below.

  const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable)
    .where(and(eq(patientsTable.id, data.patientId), eq(patientsTable.clinicId, req.user!.clinicId), isNull(patientsTable.deletedAt)));
  if (!patient) throw new NotFoundError("patient", String(data.patientId));

  const parsedItems = itemsSchema.safeParse(data.items);
  if (!parsedItems.success) {
    throw new ValidationError("Invalid items format");
  }
  const subtotal = parsedItems.data.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const discount = data.discount ?? 0;
  // F-5: bound the discount. The OpenAPI schema types it as a bare number, so without
  // this a negative discount inflates the total (overcharge) and a discount > subtotal
  // yields a negative total (usable to mask cash skimming in daily reconciliation).
  if (!Number.isFinite(discount) || discount < 0) {
    throw new ValidationError("Discount must be a non-negative number");
  }
  if (discount > subtotal) {
    throw new ValidationError("Discount cannot exceed the invoice subtotal");
  }
  const total = subtotal - discount;
  const invoiceNumber = await generateInvoiceNumber(req.user!.clinicId);

  // Point-of-sale: when markPaid, the invoice is created already paid (front desk
  // collects at the counter). This deliberately bypasses the separate pay step +
  // its SoD/anti-fraud gate, which only apply to the pending → pay-later flow.
  const paidNow = data.markPaid === true;

  const [invoice] = await db.insert(invoicesTable).values({
    clinicId: req.user!.clinicId,
    invoiceNumber, patientId: data.patientId, createdById,
    subtotal: String(subtotal), discount: String(discount),
    total: String(total), notes: data.notes,
    status: paidNow ? "paid" : "pending",
    // Use DB now() (not a JS Date) so paid_at lands in the same time frame as
    // the DB-managed created_at/updated_at columns. Mixing app `new Date()` and
    // `defaultNow()` in a `timestamp` (no-tz) column stored the two ~3h apart,
    // which dropped paid invoices out of the reconciliation day window.
    paidAt: paidNow ? sql`now()` : null,
  }).returning();

  await db.insert(invoiceItemsTable).values(
    parsedItems.data.map(item => ({
      clinicId: req.user!.clinicId,
      invoiceId: invoice.id,
      description: item.description,
      quantity: item.quantity,
      unitPrice: String(item.unitPrice),
    })),
  );

  await logAudit(req, "CREATE", "invoice", invoice.id, paidNow ? { markPaid: true } : undefined);
  if (paidNow) await logAudit(req, "PAY", "invoice", invoice.id, { atCreation: true });
  // Billing the visit moves it to checkout (best-effort; no-ops unless the
  // patient's single active visit is in_consultation/awaiting_diagnostics).
  await autoAdvanceVisit(req, { patientId: data.patientId, actions: ["payment"] });
  return { ...invoice, items: parsedItems.data };
}

export async function getInvoice(req: AuthRequest, invoiceId: number) {
  const invoice = await runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(invoicesTable.id, invoiceId), isNull(invoicesTable.deletedAt), eq(invoicesTable.clinicId, req.user!.clinicId)];
    const [row] = await tx.select().from(invoicesTable).where(and(...conditions));
    return row;
  });
  if (!invoice) throw new NotFoundError("invoice", invoiceId);
  const items = await fetchInvoiceItems(invoiceId, req.user!.clinicId);
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
  const items = await fetchInvoiceItems(invoiceId, req.user!.clinicId);
  return { ...invoice, items };
}

export async function cancelInvoice(req: AuthRequest, invoiceId: number, reason: string) {
  const conditions: any[] = [eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, req.user!.clinicId)];
  const [invoice] = await db.select().from(invoicesTable).where(and(...conditions));
  if (!invoice) throw new NotFoundError("invoice", invoiceId);
  if (invoice.status !== "pending") {
    throw new ConflictError(`Invoice is already ${invoice.status}. Cannot cancel.`);
  }

  const cancelConditions: any[] = [eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, req.user!.clinicId), eq(invoicesTable.status, "pending")];

  const [updated] = await db.update(invoicesTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(...cancelConditions))
    .returning();

  if (!updated) throw new ConflictError("Invoice status changed by a concurrent request.");
  await logAudit(req, "INVOICE_CANCEL", "invoice", invoiceId, { reason });
  const items = await fetchInvoiceItems(invoiceId, req.user!.clinicId);
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

  const payConditions: any[] = [eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, req.user!.clinicId), eq(invoicesTable.status, "pending")];

  const [updated] = await db.update(invoicesTable)
    .set({ status: "paid", paidAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(...payConditions))
    .returning();

  if (!updated) throw new ConflictError("Invoice was already paid by a concurrent request.");

  await logAudit(req, "PAY", "invoice", invoiceId, { amountReceived });
  const items = await fetchInvoiceItems(invoiceId, req.user!.clinicId);
  return { ...updated, items };
}

export async function getDailySummary(req: AuthRequest, dateStr?: string) {
  const tz = getClinicTimezone(req);
  const date = dateStr || clinicDateString(tz);
  const { start, end } = dayBoundary(date, tz);

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

/**
 * End-of-day reconciliation (Z-report). super_admin only (gated at the route).
 * Two lenses: money COLLECTED today (paidAt in window — the cash-drawer list) and
 * invoices CREATED today (createdAt in window — pending/cancelled exposure).
 */
export async function getBillingReconciliation(req: AuthRequest, dateStr?: string) {
  const tz = getClinicTimezone(req);
  const date = dateStr || clinicDateString(tz);
  const { start, end } = dayBoundary(date, tz);

  const createdInWindow = and(gte(invoicesTable.createdAt, start), lte(invoicesTable.createdAt, end));
  const paidInWindow = and(gte(invoicesTable.paidAt, start), lte(invoicesTable.paidAt, end));

  const rows = await db.select({
    id:            invoicesTable.id,
    invoiceNumber: invoicesTable.invoiceNumber,
    status:        invoicesTable.status,
    total:         invoicesTable.total,
    createdAt:     invoicesTable.createdAt,
    paidAt:        invoicesTable.paidAt,
    patientName:   patientsTable.fullName,
    createdByName: usersTable.fullName,
  })
    .from(invoicesTable)
    .leftJoin(patientsTable, eq(invoicesTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(invoicesTable.createdById, usersTable.id))
    .where(and(
      isNull(invoicesTable.deletedAt),
      eq(invoicesTable.clinicId, req.user!.clinicId),
      or(createdInWindow, paidInWindow),
    ))
    .orderBy(desc(invoicesTable.paidAt));

  const num = (v: unknown) => parseFloat(String(v)) || 0;
  const inWin = (d: Date | null | undefined) => !!d && new Date(d) >= start && new Date(d) <= end;
  const sum = (arr: typeof rows) => arr.reduce((s, r) => s + num(r.total), 0);

  const created = rows.filter(r => inWin(r.createdAt));
  const paidToday = rows.filter(r => r.status === "paid" && inWin(r.paidAt));
  const invoicedToday = created.filter(r => r.status !== "cancelled");
  const pendingToday = created.filter(r => r.status === "pending");
  const cancelledToday = created.filter(r => r.status === "cancelled");

  void logRead(req, "invoice", undefined);
  await logAudit(req, "RECONCILIATION_VIEW", "invoice", undefined, { date });

  return {
    date,
    summary: {
      collectedTotal:   sum(paidToday),     collectedCount:   paidToday.length,
      invoicedTotal:    sum(invoicedToday), invoicedCount:    invoicedToday.length,
      outstandingTotal: sum(pendingToday),  outstandingCount: pendingToday.length,
      cancelledTotal:   sum(cancelledToday),cancelledCount:   cancelledToday.length,
    },
    payments: paidToday.map(r => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      patientName: r.patientName,
      total: num(r.total),
      paidAt: r.paidAt,
      createdByName: r.createdByName,
    })),
  };
}
