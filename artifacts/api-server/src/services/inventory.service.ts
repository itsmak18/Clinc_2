import { db } from "@workspace/db";
import { inventoryTable } from "@workspace/db";
import { eq, isNull } from "drizzle-orm";
import { logAudit } from "../lib/audit";
import { NotFoundError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

export async function listInventory(params: { search?: string; category?: string }) {
  let items = await db.select().from(inventoryTable)
    .where(isNull(inventoryTable.deletedAt))
    .orderBy(inventoryTable.name);

  if (params.search) {
    const q = params.search.toLowerCase();
    items = items.filter(i => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
  }
  if (params.category) {
    items = items.filter(i => i.category === params.category);
  }
  return items;
}

export async function createInventoryItem(
  req: AuthRequest,
  data: { name: string; category: string; quantity: number; unit: string; minimumStock: number; expiryDate?: string; notes?: string },
) {
  if (!data.name || !data.category || data.quantity === undefined || !data.unit || data.minimumStock === undefined) {
    throw new ValidationError("Missing required fields");
  }
  const [item] = await db.insert(inventoryTable).values({
    name: data.name, category: data.category, quantity: data.quantity,
    unit: data.unit, minimumStock: data.minimumStock,
    expiryDate: data.expiryDate, notes: data.notes,
  }).returning();
  await logAudit(req, "CREATE", "inventory", item.id);
  return item;
}

export async function getInventoryItem(id: number) {
  const [item] = await db.select().from(inventoryTable).where(eq(inventoryTable.id, id));
  if (!item) throw new NotFoundError("inventory item", id);
  return item;
}

export async function updateInventoryItem(
  req: AuthRequest,
  id: number,
  data: Record<string, any>,
) {
  const [item] = await db.update(inventoryTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(inventoryTable.id, id))
    .returning();
  if (!item) throw new NotFoundError("inventory item", id);
  await logAudit(req, "UPDATE", "inventory", item.id);
  return item;
}
