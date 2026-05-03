import { Router } from "express";
import { db } from "@workspace/db";
import { inventoryTable } from "@workspace/db";
import { eq, isNull, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(requireAuth);
router.use("/inventory", requireRole("super_admin", "admin"));

router.get("/inventory", async (req, res) => {
  const { search, category } = req.query;
  let items = await db.select().from(inventoryTable)
    .where(isNull(inventoryTable.deletedAt))
    .orderBy(inventoryTable.name);
  if (search) {
    const q = (search as string).toLowerCase();
    items = items.filter(i => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
  }
  if (category) items = items.filter(i => i.category === category);
  res.json(items);
});

router.post("/inventory", async (req: AuthRequest, res) => {
  const { name, category, quantity, unit, minimumStock, expiryDate, notes } = req.body;
  if (!name || !category || quantity === undefined || !unit || minimumStock === undefined) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const [item] = await db.insert(inventoryTable).values({
    name, category, quantity, unit, minimumStock, expiryDate, notes,
  }).returning();
  await logAudit(req, "CREATE", "inventory", item.id);
  res.status(201).json(item);
});

router.get("/inventory/:itemId", async (req, res) => {
  const [item] = await db.select().from(inventoryTable).where(eq(inventoryTable.id, parseInt(req.params.itemId as string)));
  if (!item) { res.status(404).json({ error: "Not found" }); return; }
  res.json(item);
});

router.patch("/inventory/:itemId", async (req: AuthRequest, res) => {
  const { name, category, quantity, unit, minimumStock, expiryDate, notes, isActive } = req.body;
  const [item] = await db.update(inventoryTable)
    .set({ name, category, quantity, unit, minimumStock, expiryDate, notes, isActive, updatedAt: new Date() })
    .where(eq(inventoryTable.id, parseInt(req.params.itemId as string)))
    .returning();
  await logAudit(req, "UPDATE", "inventory", item.id);
  res.json(item);
});

export default router;
