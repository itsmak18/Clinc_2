import { Router } from "express";
import { db } from "@workspace/db";
import { auditLogsTable, usersTable } from "@workspace/db";
import { eq, gte, lte, and, desc, ilike } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);
router.use("/audit-logs", requireRole("super_admin", "admin"));

router.get("/audit-logs", async (req: AuthRequest, res) => {
  const {
    dateFrom,
    dateTo,
    action,
    userId,
    entityType,
    limit   = "200",
    offset  = "0",
  } = req.query;

  // Build all filters at the DB level — never load-all-then-filter
  const conditions = [];

  if (dateFrom) conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom as string)));
  if (dateTo) {
    const end = new Date(dateTo as string);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLogsTable.createdAt, end));
  }
  if (action)     conditions.push(eq(auditLogsTable.action,     String(action)));
  if (entityType) conditions.push(eq(auditLogsTable.entityType, String(entityType)));
  if (userId)     conditions.push(eq(auditLogsTable.userId,     parseInt(userId as string)));

  const rows = await db
    .select({
      id:         auditLogsTable.id,
      userId:     auditLogsTable.userId,
      action:     auditLogsTable.action,
      entityType: auditLogsTable.entityType,
      entityId:   auditLogsTable.entityId,
      ipAddress:  auditLogsTable.ipAddress,
      userAgent:  auditLogsTable.userAgent,
      details:    auditLogsTable.details,
      createdAt:  auditLogsTable.createdAt,
      user: {
        id:       usersTable.id,
        fullName: usersTable.fullName,
        username: usersTable.username,
        role:     usersTable.role,
      },
    })
    .from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(Math.min(parseInt(limit as string), 500))
    .offset(parseInt(offset as string));

  res.json(rows);
});

router.get("/audit-logs/entity/:entityType/:entityId", async (req: AuthRequest, res) => {
  const entityType = String(req.params.entityType);
  const entityId = parseInt(String(req.params.entityId));

  if (!entityType || isNaN(entityId)) {
    res.status(400).json({ error: "Invalid entity type or ID" });
    return;
  }

  const rows = await db
    .select({
      id:         auditLogsTable.id,
      userId:     auditLogsTable.userId,
      action:     auditLogsTable.action,
      entityType: auditLogsTable.entityType,
      entityId:   auditLogsTable.entityId,
      ipAddress:  auditLogsTable.ipAddress,
      userAgent:  auditLogsTable.userAgent,
      details:    auditLogsTable.details,
      createdAt:  auditLogsTable.createdAt,
      user: {
        id:       usersTable.id,
        fullName: usersTable.fullName,
        username: usersTable.username,
        role:     usersTable.role,
      },
    })
    .from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .where(and(eq(auditLogsTable.entityType, entityType), eq(auditLogsTable.entityId, entityId)))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(100);

  res.json(rows);
});

router.get("/audit-logs/export", async (req: AuthRequest, res) => {
  const { dateFrom, dateTo, action, userId, entityType, format = "json" } = req.query;

  const conditions = [];
  if (dateFrom) conditions.push(gte(auditLogsTable.createdAt, new Date(dateFrom as string)));
  if (dateTo) {
    const end = new Date(dateTo as string);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLogsTable.createdAt, end));
  }
  if (action)     conditions.push(eq(auditLogsTable.action,     String(action)));
  if (entityType) conditions.push(eq(auditLogsTable.entityType, String(entityType)));
  if (userId)     conditions.push(eq(auditLogsTable.userId,     parseInt(userId as string)));

  const rows = await db
    .select({
      id:         auditLogsTable.id,
      userId:     auditLogsTable.userId,
      username:   usersTable.username,
      action:     auditLogsTable.action,
      entityType: auditLogsTable.entityType,
      entityId:   auditLogsTable.entityId,
      ipAddress:  auditLogsTable.ipAddress,
      createdAt:  auditLogsTable.createdAt,
      details:    auditLogsTable.details,
    })
    .from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(10000); // hard limit for export

  if (format === "csv") {
    if (rows.length === 0) {
      res.header("Content-Type", "text/csv");
      res.send("id,userId,username,action,entityType,entityId,ipAddress,createdAt,details\n");
      return;
    }
    
    const fields = Object.keys(rows[0]);
    const csv = [
      fields.join(","),
      ...rows.map(row => fields.map(f => {
        let val = (row as any)[f];
        if (val === null || val === undefined) val = "";
        if (typeof val === "object") val = JSON.stringify(val);
        val = String(val).replace(/"/g, '""');
        return `"${val}"`;
      }).join(","))
    ].join("\n");

    res.header("Content-Type", "text/csv");
    res.attachment(`audit-logs-${new Date().toISOString().split("T")[0]}.csv`);
    res.send(csv);
    return;
  }

  // Default JSON export
  res.attachment(`audit-logs-${new Date().toISOString().split("T")[0]}.json`);
  res.json(rows);
});

export default router;
