import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, usersTable } from "@workspace/db";
import { eq, gte, lte, and, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);
router.use("/audit-logs", requireRole("super_admin"));

router.get("/audit-logs", async (req, res) => {
  const { dateFrom, dateTo, action, userId, entityType, limit = "100", offset = "0" } = req.query;

  const rows = await db.select({
    id: auditLogsTable.id,
    userId: auditLogsTable.userId,
    action: auditLogsTable.action,
    entityType: auditLogsTable.entityType,
    entityId: auditLogsTable.entityId,
    ipAddress: auditLogsTable.ipAddress,
    details: auditLogsTable.details,
    createdAt: auditLogsTable.createdAt,
    user: { id: usersTable.id, fullName: usersTable.fullName, username: usersTable.username },
  }).from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(parseInt(limit as string))
    .offset(parseInt(offset as string));

  let results = rows;
  if (action) results = results.filter(r => r.action === action);
  if (userId) results = results.filter(r => r.userId === parseInt(userId as string));
  if (entityType) results = results.filter(r => r.entityType === entityType);
  if (dateFrom) results = results.filter(r => r.createdAt >= new Date(dateFrom as string));
  if (dateTo) results = results.filter(r => r.createdAt <= new Date(dateTo as string));

  res.json(results);
});

export default router;
