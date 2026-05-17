import { db } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { NotFoundError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

export async function listNotifications(req: AuthRequest, unreadOnly: boolean) {
  let rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, req.user!.userId))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(100);

  if (unreadOnly) rows = rows.filter((n) => !n.isRead);
  return rows;
}

export async function markNotificationRead(req: AuthRequest, notificationId: number) {
  const [notif] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(
      and(
        eq(notificationsTable.id, notificationId),
        eq(notificationsTable.userId, req.user!.userId),
      ),
    )
    .returning();

  if (!notif) throw new NotFoundError("Notification not found");
  return notif;
}

export async function markAllNotificationsRead(req: AuthRequest) {
  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.userId, req.user!.userId));
}
