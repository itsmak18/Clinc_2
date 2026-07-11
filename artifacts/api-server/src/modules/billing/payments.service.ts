// dbUnsafe: recordPayment / listPayments run inside runInTenantContext (RLS-
// enforced); the invoice load, ledger insert, and status recompute all happen in
// the same tenant-scoped transaction. No raw db call sites escape that wrapper.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { paymentsTable, invoicesTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";
import { logAudit, logRead } from "../../lib/audit";
import { parseMoneyToCents, formatCents, centsToNumber } from "../../lib/money";
import { NotFoundError, ValidationError, ConflictError } from "../../services/errors";
import { settleInvoiceOrders, lockBasket, type SettleCounts } from "./clearance.service";
import type { AuthRequest } from "../../middlewares/auth";

// `db` is referenced only to keep the dbUnsafe import meaningful for the CI guard;
// every query below runs on the `tx` handle from runInTenantContext.
void db;

const PAYMENT_METHODS = ["cash", "card", "transfer", "adjustment"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * List the payment ledger for an invoice + derived balance. The ledger is the
 * financial record of truth: amountPaid = SUM(amount_cents), balance = total −
 * amountPaid. Because the full-payment fast paths (payInvoice, createInvoice
 * markPaid) also write a ledger row, every paid invoice's ledger sums to its total.
 */
export async function listPayments(req: AuthRequest, invoiceId: number) {
  const clinicId = req.user!.clinicId;

  const { invoice, rows } = await runInTenantContext(req.user!, async (tx) => {
    const [inv] = await tx
      .select({ id: invoicesTable.id, total: invoicesTable.total, status: invoicesTable.status })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, clinicId)));
    if (!inv) throw new NotFoundError("invoice", invoiceId);
    const rs = await tx
      .select()
      .from(paymentsTable)
      .where(and(eq(paymentsTable.invoiceId, invoiceId), eq(paymentsTable.clinicId, clinicId)))
      .orderBy(desc(paymentsTable.receivedAt));
    return { invoice: inv, rows: rs };
  });

  await logRead(req, "payment", invoiceId);

  const totalCents = parseMoneyToCents(String(invoice.total));
  const paidCents = rows.reduce((s, r) => s + r.amountCents, 0);
  return {
    invoiceId,
    invoiceTotal: centsToNumber(totalCents),
    amountPaid: centsToNumber(paidCents),
    balance: centsToNumber(totalCents - paidCents),
    status: invoice.status,
    payments: rows.map(r => ({
      id: r.id,
      amount: centsToNumber(r.amountCents),
      method: r.method,
      receivedById: r.receivedById,
      receivedAt: r.receivedAt,
      externalRef: r.externalRef,
      notes: r.notes,
    })),
  };
}

/**
 * Record a payment (or a negative `adjustment` refund) against an invoice, and
 * derive the invoice status from the ledger: fully covered → `paid`, otherwise
 * `pending`. Never touches a cancelled invoice. Amounts are integer cents; a
 * payment can neither push the balance below zero (overpayment) nor a refund past
 * what was collected (over-refund).
 */
export async function recordPayment(
  req: AuthRequest,
  invoiceId: number,
  data: { amount: number; method: PaymentMethod; externalRef?: string; notes?: string },
) {
  const clinicId = req.user!.clinicId;
  const receivedById = req.user!.userId;

  if (!PAYMENT_METHODS.includes(data.method)) {
    throw new ValidationError("Invalid payment method");
  }
  if (typeof data.amount !== "number" || !Number.isFinite(data.amount) || data.amount === 0) {
    throw new ValidationError("Payment amount must be a non-zero number");
  }
  const amountCents = parseMoneyToCents(data.amount);
  // Only an 'adjustment' may be negative (refund). cash/card/transfer are money in.
  if (amountCents < 0 && data.method !== "adjustment") {
    throw new ValidationError("Only an 'adjustment' payment may be negative (refund)");
  }

  const result = await runInTenantContext(req.user!, async (tx) => {
    let [invoice] = await tx
      .select()
      .from(invoicesTable)
      .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, clinicId)));
    if (!invoice) throw new NotFoundError("invoice", invoiceId);

    if (invoice.kind === "order_basket") {
      // Serialize against appendOrderCharge and re-read: the total this
      // payment settles against must be the total whose orders get cleared
      // (mirrors payInvoice; without the lock a concurrently appended charge
      // could be cleared by a ledger that never covered it).
      await lockBasket(tx, clinicId, invoice.patientId);
      [invoice] = await tx
        .select()
        .from(invoicesTable)
        .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, clinicId)));
    }
    if (invoice.status === "cancelled") {
      throw new ConflictError("Cannot record a payment against a cancelled invoice.");
    }

    const totalCents = parseMoneyToCents(String(invoice.total));

    const [{ paid }] = await tx
      .select({ paid: sql<string>`coalesce(sum(${paymentsTable.amountCents}), 0)` })
      .from(paymentsTable)
      .where(and(eq(paymentsTable.invoiceId, invoiceId), eq(paymentsTable.clinicId, clinicId)));
    const paidBefore = Number(paid);
    const paidAfter = paidBefore + amountCents;

    if (paidAfter > totalCents) {
      throw new ValidationError(
        `Payment of ${formatCents(amountCents)} exceeds the outstanding balance (${formatCents(totalCents - paidBefore)}).`,
      );
    }
    if (paidAfter < 0) {
      throw new ValidationError("Refund exceeds the amount collected on this invoice.");
    }

    const [payment] = await tx
      .insert(paymentsTable)
      .values({
        clinicId,
        invoiceId,
        amountCents,
        method: data.method,
        receivedById,
        externalRef: data.externalRef ?? null,
        notes: data.notes ?? null,
      })
      .returning();

    // Derive invoice status from the ledger. total>0 guard: a zero-total invoice
    // is never auto-marked paid by an (impossible) zero payment.
    let newStatus = invoice.status;
    let settled: SettleCounts | null = null;
    if (paidAfter >= totalCents && totalCents > 0 && invoice.status !== "paid") {
      newStatus = "paid";
      await tx
        .update(invoicesTable)
        .set({ status: "paid", paidAt: sql`now()`, updatedAt: sql`now()` })
        .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, clinicId)));
      // Clearance gate: a fully settled ledger clears the linked orders in the
      // same tx (mirrors payInvoice). Partial payments never clear. Only
      // baskets carry linked orders — manual invoices skip the settle scan.
      if (invoice.kind === "order_basket") {
        settled = await settleInvoiceOrders(tx, clinicId, invoiceId);
      }
    } else if (paidAfter < totalCents && invoice.status === "paid") {
      // A refund dropped a previously-paid invoice back below its total.
      // Deliberately does NOT revoke clearance on linked orders — the service
      // may already be underway; disputes go through the cancel workflow.
      newStatus = "pending";
      await tx
        .update(invoicesTable)
        .set({ status: "pending", paidAt: null, updatedAt: sql`now()` })
        .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, clinicId)));
    }

    return { payment, paidAfter, totalCents, newStatus, settled };
  });

  await logAudit(req, "PAYMENT_RECORDED", "invoice", invoiceId, {
    paymentId: result.payment.id,
    amount: formatCents(amountCents),
    method: data.method,
    balance: formatCents(result.totalCents - result.paidAfter),
    status: result.newStatus,
  });
  if (result.settled && result.settled.total > 0) {
    await logAudit(req, "CLEARANCE_CLEARED", "invoice", invoiceId, { counts: result.settled });
  }

  return {
    id: result.payment.id,
    invoiceId,
    amount: centsToNumber(amountCents),
    method: data.method,
    receivedAt: result.payment.receivedAt,
    invoiceStatus: result.newStatus,
    amountPaid: centsToNumber(result.paidAfter),
    balance: centsToNumber(result.totalCents - result.paidAfter),
  };
}
