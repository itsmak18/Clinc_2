// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { invoicesTable, patientsTable, invoiceItemsTable, usersTable, paymentsTable, labTestsTable, xrayRecordsTable, ultrasoundRecordsTable } from "@workspace/db";
import { eq, isNull, desc, gte, lte, and, or, sql, inArray } from "drizzle-orm";
import { dayBoundary, clinicDateString, getClinicTimezone } from "../../lib/dateUtils";
import { logAudit, logRead, auditSnapshot } from "../../lib/audit";
import { itemsSchema } from "../../lib/jsonb-schemas";
import { parseMoneyToCents, sumCents, formatCents, centsToNumber } from "../../lib/money";
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from "../../services/errors";
import { autoAdvanceVisit } from "../clinical";
import type { AuthRequest } from "../../middlewares/auth";

// Invoice numbering + the TenantTx helper type moved to ./invoice-number.ts
// (Phase A) so clearance.service.ts can number basket invoices without a
// billing.service ↔ clearance.service import cycle.
import { generateInvoiceNumber } from "./invoice-number";
import { settleInvoiceOrders, lockBasket } from "./clearance.service";

async function fetchInvoiceItems(invoiceId: number, clinicId: number) {
  const rows = await db.select({
    description: invoiceItemsTable.description,
    quantity:    invoiceItemsTable.quantity,
    unitPrice:   invoiceItemsTable.unitPrice,
  }).from(invoiceItemsTable).where(
    and(eq(invoiceItemsTable.invoiceId, invoiceId), eq(invoiceItemsTable.clinicId, clinicId)),
  );
  return rows.map(r => ({ description: r.description, quantity: r.quantity, unitPrice: centsToNumber(parseMoneyToCents(String(r.unitPrice))) }));
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
    arr.push({ description: r.description, quantity: r.quantity, unitPrice: centsToNumber(parseMoneyToCents(String(r.unitPrice))) });
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
      kind: invoicesTable.kind,
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
  await logRead(req, "invoice", undefined);
  return rows.map(r => ({ ...r, items: itemsMap.get(r.id) ?? [] }));
}

export async function createInvoice(
  req: AuthRequest,
  data: { patientId: number; items: unknown[]; discount?: number; notes?: string; markPaid?: boolean },
) {
  const createdById = req.user!.userId;
  const clinicId = req.user!.clinicId;
  // patientId + non-empty items are validated at the route by
  // validate(CreateInvoiceBody); item shape is guarded by itemsSchema below.

  // Pure validation runs BEFORE the transaction so a bad request never opens a
  // tx (and never burns an invoice sequence number on a rolled-back create).
  const parsedItems = itemsSchema.safeParse(data.items);
  if (!parsedItems.success) {
    throw new ValidationError("Invalid items format");
  }
  // All money math in integer cents (lib/money.ts). The previous float reduce
  // (`s + i.quantity * i.unitPrice`) accumulated binary-float error; quantity (int)
  // × unit price (cents) is exact per line, and sumCents never drifts.
  const subtotalCents = sumCents(parsedItems.data.map(i => i.quantity * parseMoneyToCents(i.unitPrice)));
  const discount = data.discount ?? 0;
  // F-5: bound the discount. The OpenAPI schema types it as a bare number, so without
  // this a negative discount inflates the total (overcharge) and a discount > subtotal
  // yields a negative total (usable to mask cash skimming in daily reconciliation).
  if (!Number.isFinite(discount) || discount < 0) {
    throw new ValidationError("Discount must be a non-negative number");
  }
  const discountCents = parseMoneyToCents(discount);
  if (discountCents > subtotalCents) {
    throw new ValidationError("Discount cannot exceed the invoice subtotal");
  }
  const totalCents = subtotalCents - discountCents;

  // Point-of-sale: when markPaid, the invoice is created already paid (front desk
  // collects at the counter). This deliberately bypasses the separate pay step +
  // its SoD/anti-fraud gate, which only apply to the pending → pay-later flow.
  const paidNow = data.markPaid === true;

  // Atomic create: patient check + counter increment + header + line items all
  // commit together or not at all. Previously these were separate db statements,
  // so a failure between the header insert and the items insert left an orphan
  // invoice with no line items, corrupting daily reconciliation. runInTenantContext
  // additionally applies the RLS tenant backstop to every write in this block.
  const invoice = await runInTenantContext(req.user!, async (tx) => {
    const [patient] = await tx.select({ id: patientsTable.id }).from(patientsTable)
      .where(and(eq(patientsTable.id, data.patientId), eq(patientsTable.clinicId, clinicId), isNull(patientsTable.deletedAt)));
    if (!patient) throw new NotFoundError("patient", String(data.patientId));

    const invoiceNumber = await generateInvoiceNumber(tx, clinicId);

    const [created] = await tx.insert(invoicesTable).values({
      clinicId,
      invoiceNumber, patientId: data.patientId, createdById,
      subtotal: formatCents(subtotalCents), discount: formatCents(discountCents),
      total: formatCents(totalCents), notes: data.notes,
      status: paidNow ? "paid" : "pending",
      // Use DB now() (not a JS Date) so paid_at lands in the same time frame as
      // the DB-managed created_at/updated_at columns. Mixing app `new Date()` and
      // `defaultNow()` in a `timestamp` (no-tz) column stored the two ~3h apart,
      // which dropped paid invoices out of the reconciliation day window.
      paidAt: paidNow ? sql`now()` : null,
    }).returning();

    await tx.insert(invoiceItemsTable).values(
      parsedItems.data.map(item => ({
        clinicId,
        invoiceId: created.id,
        description: item.description,
        quantity: item.quantity,
        unitPrice: String(item.unitPrice),
      })),
    );
    // Complete ledger (F-02): a POS "mark paid" create records the full payment so
    // the payments ledger stays the source of truth for every paid invoice.
    if (paidNow) {
      await tx.insert(paymentsTable).values({
        clinicId,
        invoiceId: created.id,
        amountCents: totalCents,
        method: "cash",
        receivedById: createdById,
      });
    }
    return created;
  });

  // Audit + visit-advance run AFTER the tx commits — audit stays on the outbox
  // path (never block the write on audit-DB health), and a failed create never
  // emits a CREATE event for an invoice that does not exist.
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
  await logRead(req, "invoice", invoiceId);
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
  const trimmedReason = String(reason ?? "").trim();
  if (trimmedReason.length < 30) {
    throw new ValidationError("Cancellation reason must be at least 30 characters");
  }
  const clinicId = req.user!.clinicId;
  const invoiceWhere = and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, clinicId));

  // Cancel + basket-order expiry in one tx: cancelling an order basket
  // permanently blocks its linked pending orders (clearance → expired), so a
  // cancelled bill can never leave orders that later perform unpaid.
  // Lock order (ADR-011 §11): plain read → basket advisory lock → invoice row
  // lock. The initial read must NOT lock the row, or cancel would hold
  // row→wait-advisory while a payment holds advisory→wait-row (deadlock).
  const { updated, expired } = await runInTenantContext(req.user!, async (tx) => {
    let [invoice] = await tx.select().from(invoicesTable).where(invoiceWhere);
    if (!invoice) throw new NotFoundError("invoice", invoiceId);

    if (invoice.kind === "order_basket") {
      // Serialize against appendOrderCharge: without this, an order created
      // mid-cancel lands its line after settleInvoiceOrders scanned the
      // basket, stranding the order clearance='pending' on a cancelled bill
      // until the TTL sweep. Under the lock, an append either completes
      // first (the expiry scan below sees its line) or blocks until this tx
      // commits and then opens a fresh basket.
      await lockBasket(tx, clinicId, invoice.patientId);
    }
    [invoice] = await tx.select().from(invoicesTable).where(invoiceWhere).for("update");
    if (invoice.status !== "pending") {
      throw new ConflictError(`Invoice is already ${invoice.status}. Cannot cancel.`);
    }

    const [u] = await tx.update(invoicesTable)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(invoiceWhere, eq(invoicesTable.status, "pending")))
      .returning();
    if (!u) throw new ConflictError("Invoice status changed by a concurrent request.");
    const ex = u.kind === "order_basket"
      ? await settleInvoiceOrders(tx, clinicId, invoiceId, "expired")
      : null;
    return { updated: u, expired: ex };
  });

  await logAudit(req, "INVOICE_CANCEL", "invoice", invoiceId, {
    reason: trimmedReason,
    ...(expired && expired.total > 0 ? { ordersExpired: expired } : {}),
  });
  const items = await fetchInvoiceItems(invoiceId, req.user!.clinicId);
  return { ...updated, items };
}

/**
 * SoD: which invoice kinds a role may settle. Front desk settles ORDER
 * BASKETS only (marks lab/imaging orders paid so the department knows it may
 * process them — ADR-011). Manual invoices keep the original SoD: front_desk
 * creates them, billing/admin settles them. Baskets are system-created with
 * createdById = the ordering clinician, so a front-desk payer never violates
 * creator≠payer (the 30s anti-fraud gate still applies regardless).
 * The route-level requireRole list and the frontend's canPayInvoice mirror
 * this rule — change all three together.
 */
export function canRoleSettleInvoiceKind(role: string, kind: string): boolean {
  return role !== "front_desk" || kind === "order_basket";
}

export async function payInvoice(req: AuthRequest, invoiceId: number, amountReceived?: number) {
  const clinicId = req.user!.clinicId;
  const invoiceWhere = and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, clinicId));

  // Everything — validation included — runs inside one tx. For baskets the
  // per-(clinic,patient) advisory lock serializes this payment against
  // appendOrderCharge, and the invoice is re-read UNDER the lock, so the
  // total that amountReceived is validated against is the same total that
  // gets recorded to the ledger and whose linked orders get cleared. A
  // pre-tx validation snapshot allowed a concurrently appended charge to be
  // cleared without the collected cash covering it.
  const { updated, settled } = await runInTenantContext(req.user!, async (tx) => {
    let [invoice] = await tx.select().from(invoicesTable).where(invoiceWhere);
    if (!invoice) throw new NotFoundError("invoice", invoiceId);

    if (invoice.kind === "order_basket") {
      await lockBasket(tx, clinicId, invoice.patientId);
    }
    // Row lock (ADR-011 §11): serializes same-invoice writers (payInvoice /
    // recordPayment / cancelInvoice). For a manual invoice this is the only
    // lock — without it a payment concurrent with this one reads the same
    // ledger sum and the ledger ends up over the total. Lock order is always
    // advisory (basket) → row; the initial read above never locks.
    [invoice] = await tx.select().from(invoicesTable).where(invoiceWhere).for("update");

    if (invoice.status !== "pending") {
      throw new ConflictError(`Invoice is already ${invoice.status}. Cannot process payment.`);
    }

    if (!canRoleSettleInvoiceKind(req.user!.role, invoice.kind)) {
      throw new ForbiddenError("Front desk settles order baskets only — manual invoices are settled by billing.");
    }

    // Anti-fraud: reject if the invoice was created by the same user within the last 30 seconds
    const payerId = req.user?.userId;
    const ageMs = Date.now() - new Date(invoice.createdAt).getTime();
    if (payerId && invoice.createdById === payerId && ageMs < 30_000) {
      // logAudit writes the outbox on the global connection, so the entry
      // survives this tx's rollback.
      await logAudit(req, "INVOICE_PAY_FRAUD_GATE", "invoice", invoiceId, { ageMs });
      throw new ConflictError("Invoice was created too recently by the same user. Have a second staff member process payment.");
    }

    // Ledger sum runs UNDER the row lock. This full-pay path settles the
    // OUTSTANDING BALANCE, not the face total: prior partial payments
    // (recordPayment) must be counted, or paying here would stack the full
    // total on top of them and the ledger — the record of truth (F-02) —
    // would exceed the invoice.
    const [{ paid }] = await tx
      .select({ paid: sql<string>`coalesce(sum(${paymentsTable.amountCents}), 0)` })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.invoiceId, invoiceId), eq(paymentsTable.clinicId, clinicId)));
    const remainingCents = parseMoneyToCents(String(invoice.total)) - Number(paid);

    if (amountReceived !== undefined && parseMoneyToCents(amountReceived) < remainingCents) {
      throw new ValidationError(`Amount received (${amountReceived}) is less than the outstanding balance (${formatCents(remainingCents)}).`);
    }

    // Flip to paid AND record the balancing payment in the ledger atomically.
    // The conditional UPDATE (status='pending') still guards against a
    // concurrent double-pay. Clearance gate: settling the invoice flips its
    // linked orders pending→cleared in the SAME tx, so an order is never
    // observably cleared under an unpaid invoice.
    const [u] = await tx.update(invoicesTable)
      .set({ status: "paid", paidAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(invoiceWhere, eq(invoicesTable.status, "pending")))
      .returning();
    if (!u) throw new ConflictError("Invoice was already paid by a concurrent request.");
    if (remainingCents > 0) {
      await tx.insert(paymentsTable).values({
        clinicId,
        invoiceId,
        amountCents: remainingCents,
        method: "cash",
        receivedById: req.user!.userId,
      });
    }
    // Only baskets carry linked orders — manual invoices skip the settle scan.
    const s = u.kind === "order_basket"
      ? await settleInvoiceOrders(tx, clinicId, invoiceId)
      : { lab: 0, xray: 0, ultrasound: 0, total: 0 };
    return { updated: u, settled: s };
  });

  await logAudit(req, "PAY", "invoice", invoiceId, { amountReceived });
  if (settled.total > 0) {
    await logAudit(req, "CLEARANCE_CLEARED", "invoice", invoiceId, { counts: settled });
  }
  const items = await fetchInvoiceItems(invoiceId, req.user!.clinicId);
  return { ...updated, items };
}

export async function getDailySummary(req: AuthRequest, dateStr?: string) {
  const tz = getClinicTimezone(req);
  const date = dateStr || clinicDateString(tz);
  const { start, end } = dayBoundary(date, tz);

  const conditions: any[] = [isNull(invoicesTable.deletedAt), gte(invoicesTable.createdAt, start), lte(invoicesTable.createdAt, end), eq(invoicesTable.clinicId, req.user!.clinicId)];

  const invoices = await db.select().from(invoicesTable).where(and(...conditions));

  await logRead(req, "invoice", undefined);
  return {
    totalRevenue:    centsToNumber(sumCents(invoices.filter(i => i.status === "paid").map(i => parseMoneyToCents(String(i.total))))),
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

  // Exact money: single values via parseMoneyToCents (no parseFloat), aggregates
  // summed in integer cents so the Z-report never drifts off the true figure.
  const num = (v: unknown) => (v == null ? 0 : centsToNumber(parseMoneyToCents(String(v))));
  const inWin = (d: Date | null | undefined) => !!d && new Date(d) >= start && new Date(d) <= end;
  const sum = (arr: typeof rows) => centsToNumber(sumCents(arr.map(r => parseMoneyToCents(String(r.total)))));

  const created = rows.filter(r => inWin(r.createdAt));
  const paidToday = rows.filter(r => r.status === "paid" && inWin(r.paidAt));
  const invoicedToday = created.filter(r => r.status !== "cancelled");
  const pendingToday = created.filter(r => r.status === "pending");
  const cancelledToday = created.filter(r => r.status === "cancelled");

  // Clearance gate: every emergency-overridden order whose basket is STILL
  // unpaid, regardless of date — the admin follow-up/collection list. Exact by
  // construction (overridden order ∧ pending basket), no date approximation;
  // per-event forensics live in the EMERGENCY_CLEARANCE_OVERRIDE audit trail.
  const overridesOutstanding = await getOutstandingOverrides(req);

  await logRead(req, "invoice", undefined);
  await logAudit(req, "RECONCILIATION_VIEW", "invoice", undefined, { date });

  return {
    date,
    summary: {
      collectedTotal:   sum(paidToday),     collectedCount:   paidToday.length,
      invoicedTotal:    sum(invoicedToday), invoicedCount:    invoicedToday.length,
      outstandingTotal: sum(pendingToday),  outstandingCount: pendingToday.length,
      cancelledTotal:   sum(cancelledToday),cancelledCount:   cancelledToday.length,
    },
    overridesOutstanding,
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

/**
 * Emergency-overridden orders whose basket invoice is still pending — unpaid
 * debt created by clinical overrides. Grouped per invoice for the Z-report.
 */
async function getOutstandingOverrides(req: AuthRequest) {
  const clinicId = req.user!.clinicId;
  return runInTenantContext(req.user!, async (tx) => {
    const overriddenItemIds: number[] = [];
    const pick = (rows: { invoiceItemId: number | null }[]) => {
      for (const r of rows) if (r.invoiceItemId != null) overriddenItemIds.push(r.invoiceItemId);
    };
    pick(await tx.select({ invoiceItemId: labTestsTable.invoiceItemId }).from(labTestsTable)
      .where(and(eq(labTestsTable.clinicId, clinicId), eq(labTestsTable.clearanceStatus, "overridden"), isNull(labTestsTable.deletedAt))));
    pick(await tx.select({ invoiceItemId: xrayRecordsTable.invoiceItemId }).from(xrayRecordsTable)
      .where(and(eq(xrayRecordsTable.clinicId, clinicId), eq(xrayRecordsTable.clearanceStatus, "overridden"), isNull(xrayRecordsTable.deletedAt))));
    pick(await tx.select({ invoiceItemId: ultrasoundRecordsTable.invoiceItemId }).from(ultrasoundRecordsTable)
      .where(and(eq(ultrasoundRecordsTable.clinicId, clinicId), eq(ultrasoundRecordsTable.clearanceStatus, "overridden"), isNull(ultrasoundRecordsTable.deletedAt))));

    if (overriddenItemIds.length === 0) return { orderCount: 0, invoiceCount: 0, total: 0, invoices: [] as any[] };

    const items = await tx
      .select({ id: invoiceItemsTable.id, invoiceId: invoiceItemsTable.invoiceId })
      .from(invoiceItemsTable)
      .where(and(inArray(invoiceItemsTable.id, overriddenItemIds), eq(invoiceItemsTable.clinicId, clinicId)));
    const invoiceIds = [...new Set(items.map(i => i.invoiceId))];
    if (invoiceIds.length === 0) return { orderCount: 0, invoiceCount: 0, total: 0, invoices: [] as any[] };

    const invs = await tx
      .select({
        id: invoicesTable.id,
        invoiceNumber: invoicesTable.invoiceNumber,
        total: invoicesTable.total,
        patientName: patientsTable.fullName,
      })
      .from(invoicesTable)
      .leftJoin(patientsTable, eq(invoicesTable.patientId, patientsTable.id))
      .where(and(
        inArray(invoicesTable.id, invoiceIds),
        eq(invoicesTable.clinicId, clinicId),
        eq(invoicesTable.status, "pending"),
        eq(invoicesTable.kind, "order_basket"),
        isNull(invoicesTable.deletedAt),
      ));

    const pendingInvoiceIds = new Set(invs.map(i => i.id));
    const orderCount = items.filter(i => pendingInvoiceIds.has(i.invoiceId)).length;
    const totalCents = sumCents(invs.map(i => parseMoneyToCents(String(i.total))));
    return {
      orderCount,
      invoiceCount: invs.length,
      total: centsToNumber(totalCents),
      invoices: invs.map(i => ({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        patientName: i.patientName,
        total: centsToNumber(parseMoneyToCents(String(i.total))),
      })),
    };
  });
}
