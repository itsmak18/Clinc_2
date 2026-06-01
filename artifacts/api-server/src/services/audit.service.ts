// dbUnsafe: audit reads apply manual eq(clinicId) filters already. super_admin
// reads intentionally span clinics. The direct auditLogsTable write path (login
// events) must bypass tenant context because it runs before auth completes.
import { dbUnsafe as db } from "@workspace/db";
import { auditLogsTable, usersTable } from "@workspace/db";
import { eq, gte, lte, and, desc } from "drizzle-orm";
import { logAudit } from "../lib/audit";
import { ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

const auditRowSelect = {
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
};

function buildConditions(params: {
  dateFrom?: string;
  dateTo?: string;
  action?: string;
  userId?: string;
  entityType?: string;
}) {
  const conditions = [];
  if (params.dateFrom) conditions.push(gte(auditLogsTable.createdAt, new Date(params.dateFrom)));
  if (params.dateTo) {
    const end = new Date(params.dateTo);
    end.setHours(23, 59, 59, 999);
    conditions.push(lte(auditLogsTable.createdAt, end));
  }
  if (params.action)     conditions.push(eq(auditLogsTable.action,     params.action));
  if (params.entityType) conditions.push(eq(auditLogsTable.entityType, params.entityType));
  if (params.userId)     conditions.push(eq(auditLogsTable.userId,     parseInt(params.userId)));
  return conditions;
}

export async function listAuditLogs(
  req: AuthRequest,
  params: {
    dateFrom?: string;
    dateTo?: string;
    action?: string;
    userId?: string;
    entityType?: string;
    limit?: string;
    offset?: string;
  },
) {
  void logAudit(req, "AUDIT_LOG_READ", "audit_log");
  const conditions = [eq(auditLogsTable.clinicId, req.user!.clinicId), ...buildConditions(params)];

  return db
    .select(auditRowSelect)
    .from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(Math.min(parseInt(params.limit ?? "200"), 500))
    .offset(parseInt(params.offset ?? "0"));
}

export async function getAuditLogsByEntity(
  req: AuthRequest,
  entityType: string,
  entityId: string,
) {
  if (!entityType || !entityId) throw new ValidationError("Invalid entity type or ID");
  void logAudit(req, "AUDIT_LOG_READ", "audit_log");

  return db
    .select(auditRowSelect)
    .from(auditLogsTable)
    .leftJoin(usersTable, eq(auditLogsTable.userId, usersTable.id))
    .where(and(
      eq(auditLogsTable.clinicId, req.user!.clinicId),
      eq(auditLogsTable.entityType, entityType),
      eq(auditLogsTable.entityId, entityId),
    ))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(100);
}

export async function exportAuditLogs(
  req: AuthRequest,
  params: {
    dateFrom?: string;
    dateTo?: string;
    action?: string;
    userId?: string;
    entityType?: string;
    format?: string;
  },
) {
  void logAudit(req, "AUDIT_LOG_EXPORT", "audit_log");
  const conditions = [eq(auditLogsTable.clinicId, req.user!.clinicId), ...buildConditions(params)];

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
    .where(and(...conditions))
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(10000);

  return rows;
}

export function rowsToCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "id,userId,username,action,entityType,entityId,ipAddress,createdAt,details\n";
  const fields = Object.keys(rows[0]);
  return [
    fields.join(","),
    ...rows.map((row) =>
      fields
        .map((f) => {
          let val = row[f];
          if (val === null || val === undefined) val = "";
          if (typeof val === "object") val = JSON.stringify(val);
          val = String(val).replace(/"/g, '""');
          return `"${val}"`;
        })
        .join(","),
    ),
  ].join("\n");
}
