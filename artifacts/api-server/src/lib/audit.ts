import { db } from "@workspace/db";
import { auditLogsTable } from "@workspace/db";
import type { Request } from "express";

export async function logAudit(req: Request, action: string, entityType: string, entityId?: number, details?: object) {
  const userId = (req as any).user?.userId;
  if (!userId) return;
  try {
    await db.insert(auditLogsTable).values({
      userId,
      action,
      entityType,
      entityId: entityId ?? null,
      ipAddress: req.ip || req.socket?.remoteAddress || "unknown",
      details: details ?? null,
    });
  } catch {
    // Audit failures should not break main flow
  }
}
