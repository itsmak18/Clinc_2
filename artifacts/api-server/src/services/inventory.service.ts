// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { inventoryTable, inventoryTransactionsTable, usersTable } from "@workspace/db";
import { eq, isNull, and, desc, or, ilike } from "drizzle-orm";
import { logAudit, auditSnapshot } from "../lib/audit";
import { NotFoundError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

type TxnReason = "initial" | "restock" | "consumed" | "expired" | "adjustment";

export async function listInventory(req: AuthRequest, params: { search?: string; category?: string }) {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [isNull(inventoryTable.deletedAt), eq(inventoryTable.clinicId, req.user!.clinicId)];

    if (params.category) {
      conditions.push(eq(inventoryTable.category, params.category));
    }
    if (params.search) {
      // Escape LIKE wildcards so a literal % / _ in the term stays literal (preserving
      // the previous JS `.includes()` semantics), then match case-insensitively in SQL.
      const term = `%${params.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      conditions.push(or(ilike(inventoryTable.name, term), ilike(inventoryTable.category, term)));
    }

    return tx.select().from(inventoryTable)
      .where(and(...conditions))
      .orderBy(inventoryTable.name);
  });
}

export async function createInventoryItem(
  req: AuthRequest,
  data: { name: string; category: string; quantity: number; unit: string; minimumStock: number; expiryDate?: string; notes?: string },
) {
  if (!data.name || !data.category || data.quantity === undefined || !data.unit || data.minimumStock === undefined) {
    throw new ValidationError("Missing required fields");
  }

  return runInTenantContext(req.user!, async (tx) => {
    const [item] = await tx.insert(inventoryTable).values({
      clinicId: req.user!.clinicId,
      name: data.name, category: data.category, quantity: data.quantity,
      unit: data.unit, minimumStock: data.minimumStock,
      expiryDate: data.expiryDate, notes: data.notes,
    }).returning();
    await logAudit(req, "CREATE", "inventory", item.id);

    // Opening balance — record an "initial" ledger entry when stock starts > 0.
    if (item.quantity > 0) {
      await tx.insert(inventoryTransactionsTable).values({
        clinicId: req.user!.clinicId, itemId: item.id,
        delta: item.quantity, quantityAfter: item.quantity,
        reason: "initial", performedById: req.user!.userId,
      });
    }
    return item;
  });
}

export async function getInventoryItem(req: AuthRequest, id: number) {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(inventoryTable.id, id), eq(inventoryTable.clinicId, req.user!.clinicId), isNull(inventoryTable.deletedAt)];
    const [item] = await tx.select().from(inventoryTable).where(and(...conditions));
    if (!item) throw new NotFoundError("inventory item", id);
    return item;
  });
}

export async function updateInventoryItem(
  req: AuthRequest,
  id: number,
  data: Record<string, any>,
) {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(inventoryTable.id, id), eq(inventoryTable.clinicId, req.user!.clinicId), isNull(inventoryTable.deletedAt)];
    const [before] = await tx.select().from(inventoryTable).where(and(...conditions));
    if (!before) throw new NotFoundError("inventory item", id);
    const [item] = await tx.update(inventoryTable)
      .set({ ...data, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    if (!item) throw new NotFoundError("inventory item", id);
    const fields = Object.keys(data).filter(k => k !== "updatedAt");
    await logAudit(req, "UPDATE", "inventory", item.id, { fields }, auditSnapshot(before), auditSnapshot(item));

    // A quantity edit through the general update is a manual adjustment — record it.
    if (typeof data.quantity === "number" && data.quantity !== before.quantity) {
      await tx.insert(inventoryTransactionsTable).values({
        clinicId: req.user!.clinicId, itemId: item.id,
        delta: data.quantity - before.quantity, quantityAfter: data.quantity,
        reason: "adjustment", performedById: req.user!.userId,
      });
    }
    return item;
  });
}

export async function deleteInventoryItem(req: AuthRequest, id: number) {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(inventoryTable.id, id), eq(inventoryTable.clinicId, req.user!.clinicId), isNull(inventoryTable.deletedAt)];
    const [before] = await tx.select().from(inventoryTable).where(and(...conditions));
    if (!before) throw new NotFoundError("inventory item", id);
    const [after] = await tx.update(inventoryTable)
      .set({ deletedAt: new Date() })
      .where(and(...conditions))
      .returning();
    await logAudit(req, "DELETE", "inventory", id, null, auditSnapshot(before), auditSnapshot(after));
  });
}

/**
 * Apply a signed stock movement and record it in the ledger atomically.
 * delta > 0 = stock in (restock); delta < 0 = stock out (consumed/expired).
 */
export async function adjustInventoryStock(
  req: AuthRequest,
  id: number,
  body: { delta: number; reason: TxnReason; note?: string },
) {
  const delta = Number(body.delta);
  if (!Number.isInteger(delta) || delta === 0) throw new ValidationError("Adjustment must be a non-zero whole number");
  const allowed: TxnReason[] = ["restock", "consumed", "expired", "adjustment"];
  if (!allowed.includes(body.reason)) throw new ValidationError("Invalid adjustment reason");

  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(inventoryTable.id, id), eq(inventoryTable.clinicId, req.user!.clinicId), isNull(inventoryTable.deletedAt)];
    const [before] = await tx.select().from(inventoryTable).where(and(...conditions));
    if (!before) throw new NotFoundError("inventory item", id);

    const next = before.quantity + delta;
    if (next < 0) throw new ValidationError("Insufficient stock for this adjustment");

    const [item] = await tx.update(inventoryTable)
      .set({ quantity: next, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    await tx.insert(inventoryTransactionsTable).values({
      clinicId: req.user!.clinicId, itemId: id,
      delta, quantityAfter: next,
      reason: body.reason, note: body.note || null,
      performedById: req.user!.userId,
    });
    await logAudit(req, "STOCK_ADJUST", "inventory", id, { delta, reason: body.reason });
    return item;
  });
}

export async function listInventoryTransactions(req: AuthRequest, itemId: number) {
  return runInTenantContext(req.user!, async (tx) => {
    // Confirm the item belongs to this clinic before exposing its ledger.
    const [item] = await tx.select({ id: inventoryTable.id }).from(inventoryTable)
      .where(and(eq(inventoryTable.id, itemId), eq(inventoryTable.clinicId, req.user!.clinicId)));
    if (!item) throw new NotFoundError("inventory item", itemId);

    const rows = await tx.select({
      id: inventoryTransactionsTable.id,
      delta: inventoryTransactionsTable.delta,
      quantityAfter: inventoryTransactionsTable.quantityAfter,
      reason: inventoryTransactionsTable.reason,
      note: inventoryTransactionsTable.note,
      performedById: inventoryTransactionsTable.performedById,
      performedByName: usersTable.fullName,
      createdAt: inventoryTransactionsTable.createdAt,
    })
      .from(inventoryTransactionsTable)
      .leftJoin(usersTable, eq(usersTable.id, inventoryTransactionsTable.performedById))
      .where(and(
        eq(inventoryTransactionsTable.clinicId, req.user!.clinicId),
        eq(inventoryTransactionsTable.itemId, itemId),
      ))
      .orderBy(desc(inventoryTransactionsTable.createdAt))
      .limit(100);
    return rows;
  });
}
