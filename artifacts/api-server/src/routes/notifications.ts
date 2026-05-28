import { Router } from "express";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { asyncHandler } from "../middlewares/asyncHandler";
import { ValidationError } from "../services/errors";
import { safeParseInt } from "../lib/validators";
import { addSSEClient, removeSSEClient } from "../lib/sse";
import { isShuttingDown } from "../lib/lifecycle";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "../services/notifications.service";

const router = Router();
router.use(requireAuth);

router.get("/notifications/stream", (req: AuthRequest, res) => {
  // Refuse new SSE connections during graceful shutdown so that in-flight
  // connections can drain cleanly and the LB stops routing new traffic here.
  if (isShuttingDown()) {
    res.status(503).set("Retry-After", "10").json({ error: "Server draining" });
    return;
  }

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

router.get(
  "/notifications",
  asyncHandler(async (req: AuthRequest, res) => {
    const unreadOnly = req.query.unreadOnly === "true";
    res.json(await listNotifications(req, unreadOnly));
  }),
);

router.post(
  "/notifications/:notificationId/read",
  asyncHandler(async (req: AuthRequest, res) => {
    const notificationId = safeParseInt(req.params.notificationId);
    if (!notificationId) throw new ValidationError("Invalid notification ID");
    res.json(await markNotificationRead(req, notificationId));
  }),
);

router.post(
  "/notifications/read-all",
  asyncHandler(async (req: AuthRequest, res) => {
    await markAllNotificationsRead(req);
    res.json({ success: true });
  }),
);

export default router;
