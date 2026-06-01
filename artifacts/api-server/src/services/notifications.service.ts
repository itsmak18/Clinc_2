// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { notificationsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { NotFoundError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

export async function listNotifications(req: AuthRequest, unreadOnly: boolean) {
  return runInTenantContext(req.user!, async (tx) => {
    let rows = await tx
      .select()
      .from(notificationsTable)
      .where(and(eq(notificationsTable.userId, req.user!.userId), eq(notificationsTable.clinicId, req.user!.clinicId)))
      .orderBy(desc(notificationsTable.createdAt))
      .limit(100);

    if (unreadOnly) rows = rows.filter((n) => !n.isRead);
    return rows;
  });
}

export async function markNotificationRead(req: AuthRequest, notificationId: number) {
  return runInTenantContext(req.user!, async (tx) => {
    const [notif] = await tx
      .update(notificationsTable)
      .set({ isRead: true })
      .where(
        and(
          eq(notificationsTable.id, notificationId),
          eq(notificationsTable.userId, req.user!.userId),
          eq(notificationsTable.clinicId, req.user!.clinicId),
        ),
      )
      .returning();

    if (!notif) throw new NotFoundError("Notification not found");
    return notif;
  });
}

export async function markAllNotificationsRead(req: AuthRequest) {
  await runInTenantContext(req.user!, async (tx) => {
    await tx
      .update(notificationsTable)
      .set({ isRead: true })
      .where(and(eq(notificationsTable.userId, req.user!.userId), eq(notificationsTable.clinicId, req.user!.clinicId)));
  });
}
