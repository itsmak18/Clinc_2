/**
 * Financial clearance gate (Phase A, ADR-011).
 *
 * Clinical orders (lab tests, x-ray, ultrasound) are created with
 * clearance_status='pending' and an auto-generated charge line on the
 * patient's open "basket" invoice (kind='order_basket', at most one open per
 * patient — enforced by the invoice_open_basket_uq partial unique index).
 * Paying the basket flips every linked order to 'cleared', which unblocks
 * workflow progress (requested → in_progress → completed). A clinical
 * emergency override flips orders to 'overridden' while the invoice stays
 * pending (the debt remains visible). Orders never paid within
 * CLEARANCE_TTL_HOURS expire via the hourly cron.
 *
 * Flag semantics: the CONTROL PLANE (creating pending clearances, blocking
 * workflow progress, the override endpoint) is gated on
 * CLEARANCE_GATE_ENABLED — callers branch on isClearanceGateEnabled(). The
 * DATA PLANE (settling on payment, the expiry sweep) runs unconditionally:
 * it only ever touches rows that can exist because the gate was on, so it is
 * naturally a no-op on flag-OFF deployments, and it keeps working after a
 * rollback — flipping the flag off must not orphan in-flight pending
 * baskets/orders.
 *
 */
// dbUnsafe: expirePendingClearances() is a system cron sweep that is
// deliberately cross-tenant (the TTL rule is tenant-uniform, there is no
// request context); every other function runs on the caller's
// runInTenantContext transaction.
import { dbUnsafe as db } from "@workspace/db";
import {
  invoicesTable,
  invoiceItemsTable,
  labTestsTable,
  xrayRecordsTable,
  ultrasoundRecordsTable,
  runInTenantContext,
} from "@workspace/db";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Request } from "express";
import { config } from "../../lib/config";
import { logger } from "../../lib/logger";
import { logAudit, SYSTEM_USER_ID } from "../../lib/audit";
import { parseMoneyToCents, sumCents, formatCents } from "../../lib/money";
import { NotFoundError, ValidationError, ConflictError, ClearanceGateDisabledError } from "../../services/errors";
import { generateInvoiceNumber, type TenantTx } from "./invoice-number";
import { getServiceByCode } from "./services-catalog.service";
import type { AuthRequest } from "../../middlewares/auth";

type AuthUser = NonNullable<AuthRequest["user"]>;

/** Catalog codes the auto-charge path maps each order modality to. */
export const CLEARANCE_CATALOG_CODES = {
  lab: "LAB_DEFAULT",
  xray: "XRAY_DEFAULT",
  ultrasound: "US_DEFAULT",
} as const;

export type ClearanceModality = keyof typeof CLEARANCE_CATALOG_CODES;

export function isClearanceGateEnabled(): boolean {
  return config.clearanceGateEnabled;
}

// Workflow statuses that mean "the service is being / has been performed" —
// blocked while the order still awaits financial clearance (ADR-011).
const CLEARANCE_BLOCKED_STATUSES: readonly string[] = ["in_progress", "completed"];
const CLEARANCE_OK: readonly string[] = ["cleared", "overridden"];

/**
 * The one clearance guard all modality services share: true when moving the
 * order to `newStatus` must be rejected (409/3020) because it still awaits
 * financial clearance. Cancel is never blocked.
 */
export function clearanceBlocksProgress(newStatus: string | undefined, clearanceStatus: string): boolean {
  return !!newStatus && CLEARANCE_BLOCKED_STATUSES.includes(newStatus) && !CLEARANCE_OK.includes(clearanceStatus);
}

const CLEARANCE_FILTER_VALUES = ["pending", "cleared", "overridden", "expired"] as const;
export type ClearanceFilterStatus = (typeof CLEARANCE_FILTER_VALUES)[number];

/**
 * Parse the `clearanceStatus` list-filter query param shared by the three
 * order list endpoints. Accepts a single value or a comma list
 * ("cleared,overridden" — the department "ready to process" tab). Unknown
 * values are a 400, never silently dropped (validate-don't-transform).
 */
export function parseClearanceStatusFilter(raw: string): ClearanceFilterStatus[] {
  const values = raw.split(",").map((v) => v.trim()).filter(Boolean);
  if (values.length === 0) {
    throw new ValidationError("clearanceStatus: empty filter");
  }
  for (const v of values) {
    if (!(CLEARANCE_FILTER_VALUES as readonly string[]).includes(v)) {
      throw new ValidationError(`clearanceStatus: unknown value '${v}'`);
    }
  }
  return values as ClearanceFilterStatus[];
}

/**
 * Own-line charge exposed on department order rows (clearance-visibility plan
 * D1): the order's own `quantity × unit_price` and NOTHING else — no invoice
 * totals, basket balance, or payment history. Department roles may see what
 * the request they received costs, not the patient's wider bill.
 */
export function orderChargeFromLine(
  quantity: number | null,
  unitPrice: string | null,
): { amountCents: number } | null {
  if (quantity == null || unitPrice == null) return null;
  return { amountCents: quantity * parseMoneyToCents(unitPrice) };
}

/**
 * Serialize basket mutations per (clinic, patient) with a transaction-scoped
 * advisory lock, held until the caller's tx ends. EVERY writer that appends
 * to, settles, or re-reads-then-settles a basket must take this lock first —
 * appendOrderCharge (via findOrCreateBasket), payInvoice, recordPayment —
 * otherwise a charge appended concurrently with a payment can either be
 * cleared without the collected cash covering it, or land on an
 * already-paid, frozen invoice.
 */
export async function lockBasket(tx: TenantTx, clinicId: number, patientId: number) {
  // hashtext maps the key to a lock id.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`basket:${clinicId}:${patientId}`}))`);
}

/**
 * Find the patient's open basket invoice or create one. Runs on the caller's
 * tx. Concurrency: serialized per (clinic, patient) via lockBasket — the
 * loser blocks until the winner's tx commits, then its SELECT sees the
 * winner's basket. (An ON CONFLICT DO NOTHING + re-select approach proved
 * racy under parallel creates in the integration suite; the
 * invoice_open_basket_uq partial unique index remains as the DB-level
 * backstop.) The lock is deliberately taken BEFORE the fast-path select:
 * it is the same lock the payment paths hold while settling, so a basket
 * observed 'pending' here cannot be concurrently flipped to 'paid' before
 * this tx commits its charge line.
 */
export async function findOrCreateBasket(tx: TenantTx, user: AuthUser, patientId: number) {
  const openBasketWhere = and(
    eq(invoicesTable.clinicId, user.clinicId),
    eq(invoicesTable.patientId, patientId),
    eq(invoicesTable.kind, "order_basket"),
    eq(invoicesTable.status, "pending"),
    isNull(invoicesTable.deletedAt),
  );

  await lockBasket(tx, user.clinicId, patientId);

  const [existing] = await tx.select().from(invoicesTable).where(openBasketWhere);
  if (existing) return existing;

  const invoiceNumber = await generateInvoiceNumber(tx, user.clinicId);
  const [created] = await tx
    .insert(invoicesTable)
    .values({
      clinicId: user.clinicId,
      invoiceNumber,
      patientId,
      createdById: user.userId,
      subtotal: "0.00",
      discount: "0.00",
      total: "0.00",
      status: "pending",
      kind: "order_basket",
    })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost the race — the concurrent creator's basket is now visible in-tx.
  const [winner] = await tx.select().from(invoicesTable).where(openBasketWhere);
  if (!winner) {
    // Can only happen if the winner committed AND was paid/cancelled between
    // our two statements — vanishingly rare; surface as a retryable conflict.
    throw new ConflictError("Basket invoice changed concurrently — retry the order.");
  }
  return winner;
}

/** Re-derive a pending basket's subtotal/total from its line items (integer cents). */
export async function recomputeBasketTotals(tx: TenantTx, clinicId: number, invoiceId: number) {
  const items = await tx
    .select({ quantity: invoiceItemsTable.quantity, unitPrice: invoiceItemsTable.unitPrice })
    .from(invoiceItemsTable)
    .where(and(eq(invoiceItemsTable.invoiceId, invoiceId), eq(invoiceItemsTable.clinicId, clinicId)));

  const [invoice] = await tx
    .select({ discount: invoicesTable.discount, status: invoicesTable.status, kind: invoicesTable.kind })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, clinicId)));
  if (!invoice) throw new NotFoundError("invoice", invoiceId);
  // Only open baskets are ever recomputed — paid/cancelled invoices are frozen.
  if (invoice.status !== "pending" || invoice.kind !== "order_basket") return;

  const subtotalCents = sumCents(items.map(i => i.quantity * parseMoneyToCents(String(i.unitPrice))));
  const discountCents = parseMoneyToCents(String(invoice.discount));
  await tx
    .update(invoicesTable)
    .set({
      subtotal: formatCents(subtotalCents),
      total: formatCents(subtotalCents - discountCents),
      updatedAt: sql`now()`,
    })
    .where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.clinicId, clinicId)));
}

/**
 * Append the auto-charge for a newly created clinical order onto the
 * patient's basket. Returns the line so the caller can stamp the order row
 * with invoiceItemId inside the same transaction.
 */
export async function appendOrderCharge(
  tx: TenantTx,
  user: AuthUser,
  opts: { patientId: number; modality: ClearanceModality; description: string },
): Promise<{ invoiceId: number; invoiceItemId: number }> {
  const basket = await findOrCreateBasket(tx, user, opts.patientId);

  const code = CLEARANCE_CATALOG_CODES[opts.modality];
  const service = await getServiceByCode(tx, user.clinicId, code);
  const unitPrice = service ? String(service.defaultPrice) : "0.00";
  if (!service || parseMoneyToCents(unitPrice) === 0) {
    // The gate is financially toothless until the operator prices the catalog
    // codes — a zero-total basket is instantly payable. Loud so ops notices.
    logger.warn(
      { clinicId: user.clinicId, code, found: !!service },
      "clearance_zero_price_charge — set a price on this catalog code",
    );
  }

  const [item] = await tx
    .insert(invoiceItemsTable)
    .values({
      clinicId: user.clinicId,
      invoiceId: basket.id,
      serviceId: service?.id ?? null,
      description: opts.description,
      quantity: 1,
      unitPrice,
    })
    .returning();

  await recomputeBasketTotals(tx, user.clinicId, basket.id);
  return { invoiceId: basket.id, invoiceItemId: item.id };
}

export interface SettleCounts {
  lab: number;
  xray: number;
  ultrasound: number;
  total: number;
}

/**
 * Flip every order linked to this invoice from 'pending' to `to`
 * ('cleared' on payment, 'overridden' on emergency override, 'expired' when
 * the basket itself is cancelled). Called inside the same transaction that
 * settles the invoice, so an order can never be observed cleared while its
 * invoice is still pending. Idempotent: only 'pending' orders move.
 */
export async function settleInvoiceOrders(
  tx: TenantTx,
  clinicId: number,
  invoiceId: number,
  to: "cleared" | "overridden" | "expired" = "cleared",
): Promise<SettleCounts> {
  const items = await tx
    .select({ id: invoiceItemsTable.id })
    .from(invoiceItemsTable)
    .where(and(eq(invoiceItemsTable.invoiceId, invoiceId), eq(invoiceItemsTable.clinicId, clinicId)));
  const itemIds = items.map(i => i.id);
  if (itemIds.length === 0) return { lab: 0, xray: 0, ultrasound: 0, total: 0 };

  const lab = await tx
    .update(labTestsTable)
    .set({ clearanceStatus: to, updatedAt: sql`now()` })
    .where(and(
      eq(labTestsTable.clinicId, clinicId),
      inArray(labTestsTable.invoiceItemId, itemIds),
      eq(labTestsTable.clearanceStatus, "pending"),
    ))
    .returning({ id: labTestsTable.id });

  const xray = await tx
    .update(xrayRecordsTable)
    .set({ clearanceStatus: to, updatedAt: sql`now()` })
    .where(and(
      eq(xrayRecordsTable.clinicId, clinicId),
      inArray(xrayRecordsTable.invoiceItemId, itemIds),
      eq(xrayRecordsTable.clearanceStatus, "pending"),
    ))
    .returning({ id: xrayRecordsTable.id });

  const ultrasound = await tx
    .update(ultrasoundRecordsTable)
    .set({ clearanceStatus: to, updatedAt: sql`now()` })
    .where(and(
      eq(ultrasoundRecordsTable.clinicId, clinicId),
      inArray(ultrasoundRecordsTable.invoiceItemId, itemIds),
      eq(ultrasoundRecordsTable.clearanceStatus, "pending"),
    ))
    .returning({ id: ultrasoundRecordsTable.id });

  return {
    lab: lab.length,
    xray: xray.length,
    ultrasound: ultrasound.length,
    total: lab.length + xray.length + ultrasound.length,
  };
}

/**
 * Remove one auto-charge line from its (still pending) basket — the
 * cancel-order and expiry paths. Nulls the order-side invoiceItemId
 * references first (FK), deletes the line, recomputes totals, and cancels
 * the basket outright when it just lost its last line.
 * No-op (returns removed:false) when the invoice already settled — a paid
 * basket is frozen history.
 */
export async function removeOrderCharge(
  tx: TenantTx,
  clinicId: number,
  invoiceItemId: number,
  modality?: ClearanceModality,
): Promise<{ removed: boolean; basketCancelled: boolean; invoiceId: number | null }> {
  const [item] = await tx
    .select({ id: invoiceItemsTable.id, invoiceId: invoiceItemsTable.invoiceId })
    .from(invoiceItemsTable)
    .where(and(eq(invoiceItemsTable.id, invoiceItemId), eq(invoiceItemsTable.clinicId, clinicId)));
  if (!item) return { removed: false, basketCancelled: false, invoiceId: null };

  const [invoice] = await tx
    .select({ id: invoicesTable.id, status: invoicesTable.status, kind: invoicesTable.kind })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.id, item.invoiceId), eq(invoicesTable.clinicId, clinicId)));
  if (!invoice || invoice.status !== "pending" || invoice.kind !== "order_basket") {
    return { removed: false, basketCancelled: false, invoiceId: item.invoiceId };
  }

  // FK: order rows point at the line — detach them before deleting it. When
  // the caller knows the order's modality only that table is touched.
  if (!modality || modality === "lab") {
    await tx.update(labTestsTable).set({ invoiceItemId: null })
      .where(and(eq(labTestsTable.clinicId, clinicId), eq(labTestsTable.invoiceItemId, invoiceItemId)));
  }
  if (!modality || modality === "xray") {
    await tx.update(xrayRecordsTable).set({ invoiceItemId: null })
      .where(and(eq(xrayRecordsTable.clinicId, clinicId), eq(xrayRecordsTable.invoiceItemId, invoiceItemId)));
  }
  if (!modality || modality === "ultrasound") {
    await tx.update(ultrasoundRecordsTable).set({ invoiceItemId: null })
      .where(and(eq(ultrasoundRecordsTable.clinicId, clinicId), eq(ultrasoundRecordsTable.invoiceItemId, invoiceItemId)));
  }

  await tx.delete(invoiceItemsTable)
    .where(and(eq(invoiceItemsTable.id, invoiceItemId), eq(invoiceItemsTable.clinicId, clinicId)));

  const [{ remaining }] = await tx
    .select({ remaining: sql<number>`count(*)::int` })
    .from(invoiceItemsTable)
    .where(and(eq(invoiceItemsTable.invoiceId, item.invoiceId), eq(invoiceItemsTable.clinicId, clinicId)));

  if (remaining === 0) {
    await tx
      .update(invoicesTable)
      .set({ status: "cancelled", notes: "auto-cancelled: basket emptied (all orders cancelled/expired)", updatedAt: sql`now()` })
      .where(and(
        eq(invoicesTable.id, item.invoiceId),
        eq(invoicesTable.clinicId, clinicId),
        eq(invoicesTable.status, "pending"),
      ));
    return { removed: true, basketCancelled: true, invoiceId: item.invoiceId };
  }

  await recomputeBasketTotals(tx, clinicId, item.invoiceId);
  return { removed: true, basketCancelled: false, invoiceId: item.invoiceId };
}

/**
 * Emergency clearance override — clinical roles unblock a patient's pending
 * orders without payment. The basket invoice deliberately STAYS pending so
 * the debt remains visible for follow-up collection; the reconciliation
 * report surfaces every override for daily admin review.
 */
export async function overrideInvoiceClearance(req: AuthRequest, invoiceId: number, reason: string) {
  if (!isClearanceGateEnabled()) throw new ClearanceGateDisabledError();
  const trimmed = String(reason ?? "").trim();
  if (trimmed.length < 30) {
    throw new ValidationError("Override reason must be at least 30 characters");
  }

  const counts = await runInTenantContext(req.user!, async (tx) => {
    const [invoice] = await tx
      .select()
      .from(invoicesTable)
      .where(and(
        eq(invoicesTable.id, invoiceId),
        eq(invoicesTable.clinicId, req.user!.clinicId),
        isNull(invoicesTable.deletedAt),
      ));
    if (!invoice) throw new NotFoundError("invoice", invoiceId);
    if (invoice.kind !== "order_basket") {
      throw new ConflictError("Only order-basket invoices can be clearance-overridden.");
    }
    if (invoice.status !== "pending") {
      throw new ConflictError(`Invoice is already ${invoice.status} — nothing to override.`);
    }

    const c = await settleInvoiceOrders(tx, req.user!.clinicId, invoiceId, "overridden");
    if (c.total === 0) {
      throw new ConflictError("No orders are awaiting clearance on this invoice.");
    }
    return c;
  });

  await logAudit(req, "EMERGENCY_CLEARANCE_OVERRIDE", "invoice", invoiceId, {
    reason: trimmed,
    counts,
  });
  return { overriddenCount: counts.total, counts };
}

/**
 * Hourly cron sweep: orders that sat pending-clearance past the TTL expire,
 * their basket lines are removed (totals shrink; an emptied basket cancels),
 * and one summary system-audit row per affected clinic records the run.
 * Cross-tenant by design — the TTL rule is tenant-uniform and there is no
 * request context. Deliberately NOT flag-gated (data plane, see header):
 * pending rows can only exist from flag-ON operation, and they must still
 * drain after a rollback flips the flag off.
 */
export async function expirePendingClearances(): Promise<{ expired: number; basketsCancelled: number }> {
  const cutoff = new Date(Date.now() - config.clearanceTtlHours * 3_600_000);

  const result = await db.transaction(async (tx) => {
    const expired: { table: ClearanceModality; id: number; clinicId: number; invoiceItemId: number | null }[] = [];

    const lab = await tx
      .update(labTestsTable)
      .set({ clearanceStatus: "expired", updatedAt: sql`now()` })
      .where(and(eq(labTestsTable.clearanceStatus, "pending"), lt(labTestsTable.createdAt, cutoff), isNull(labTestsTable.deletedAt)))
      .returning({ id: labTestsTable.id, clinicId: labTestsTable.clinicId, invoiceItemId: labTestsTable.invoiceItemId });
    for (const r of lab) expired.push({ table: "lab", ...r });

    const xray = await tx
      .update(xrayRecordsTable)
      .set({ clearanceStatus: "expired", updatedAt: sql`now()` })
      .where(and(eq(xrayRecordsTable.clearanceStatus, "pending"), lt(xrayRecordsTable.createdAt, cutoff), isNull(xrayRecordsTable.deletedAt)))
      .returning({ id: xrayRecordsTable.id, clinicId: xrayRecordsTable.clinicId, invoiceItemId: xrayRecordsTable.invoiceItemId });
    for (const r of xray) expired.push({ table: "xray", ...r });

    const us = await tx
      .update(ultrasoundRecordsTable)
      .set({ clearanceStatus: "expired", updatedAt: sql`now()` })
      .where(and(eq(ultrasoundRecordsTable.clearanceStatus, "pending"), lt(ultrasoundRecordsTable.createdAt, cutoff), isNull(ultrasoundRecordsTable.deletedAt)))
      .returning({ id: ultrasoundRecordsTable.id, clinicId: ultrasoundRecordsTable.clinicId, invoiceItemId: ultrasoundRecordsTable.invoiceItemId });
    for (const r of us) expired.push({ table: "ultrasound", ...r });

    let basketsCancelled = 0;
    const basketsCancelledByClinic = new Map<number, number>();
    for (const row of expired) {
      if (row.invoiceItemId == null) continue;
      const { basketCancelled } = await removeOrderCharge(tx as unknown as TenantTx, row.clinicId, row.invoiceItemId, row.table);
      if (basketCancelled) {
        basketsCancelled += 1;
        basketsCancelledByClinic.set(row.clinicId, (basketsCancelledByClinic.get(row.clinicId) ?? 0) + 1);
      }
    }

    return { expired, basketsCancelled, basketsCancelledByClinic };
  });

  if (result.expired.length > 0) {
    // One summary entry PER CLINIC, attributed to that clinic (system actor
    // userId). A single cross-tenant row would land under SYSTEM_CLINIC_ID
    // (= clinic 1) with every clinic's order ids in its details — readable by
    // clinic 1's compliance officers, since audit reads are WHERE-scoped to
    // the caller's clinic. Each clinic must only ever see its own orders.
    const byClinic = new Map<number, typeof result.expired>();
    for (const row of result.expired) {
      const list = byClinic.get(row.clinicId) ?? [];
      list.push(row);
      byClinic.set(row.clinicId, list);
    }
    for (const [clinicId, orders] of byClinic) {
      const systemReq = { headers: {}, user: { userId: SYSTEM_USER_ID, clinicId } } as unknown as Request;
      await logAudit(systemReq, "SYSTEM_CLEARANCE_EXPIRED", "order", undefined, {
        count: orders.length,
        basketsCancelled: result.basketsCancelledByClinic.get(clinicId) ?? 0,
        ttlHours: config.clearanceTtlHours,
        orders: orders.map(({ table, id, invoiceItemId }) => ({ table, id, invoiceItemId })),
      });
    }
  }

  return { expired: result.expired.length, basketsCancelled: result.basketsCancelled };
}
