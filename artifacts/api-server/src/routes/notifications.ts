import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

router.get("/notifications", async (req: AuthRequest, res) => {
  const { unreadOnly } = req.query;
  let notifications = await db.select().from(notificationsTable)
    .where(eq(notificationsTable.userId, req.user!.userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(100);
  if (unreadOnly === "true") notifications = notifications.filter(n => !n.isRead);
  res.json(notifications);
});

router.post("/notifications/:notificationId/read", async (req: AuthRequest, res) => {
  const [notif] = await db.update(notificationsTable)
    .set({ isRead: true })
    .where(and(
      eq(notificationsTable.id, parseInt(req.params.notificationId)),
      eq(notificationsTable.userId, req.user!.userId)
    ))
    .returning();
  res.json(notif);
});

router.post("/notifications/read-all", async (req: AuthRequest, res) => {
  await db.update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.userId, req.user!.userId));
  res.json({ success: true });
});

export default router;
