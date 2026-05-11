import { Router } from "express";
import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { addSSEClient, removeSSEClient } from "../lib/sse";

const router = Router();
router.use(requireAuth);

router.get("/notifications/stream", (req: AuthRequest, res) => {
  const userId = req.user!.userId;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`);

  addSSEClient(userId, res);

  const keepAlive = setInterval(() => {
    try { res.write(`: ping\n\n`); } catch { clearInterval(keepAlive); }
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    removeSSEClient(userId, res);
  });
});

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
      eq(notificationsTable.id, parseInt(req.params.notificationId as string)),
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
