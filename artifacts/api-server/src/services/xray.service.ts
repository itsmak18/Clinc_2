import { db } from "@workspace/db";
import { xrayRecordsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, isNull, desc, and, inArray } from "drizzle-orm";
import { logAudit, logRead } from "../lib/audit";
import { safeParseInt } from "../lib/validators";
import { emitToUser } from "../lib/sse";
import { isDoctorScoped, getDoctorPatientScope } from "../lib/scope";
import { NotFoundError, ForbiddenError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

export async function listXrays(
  req: AuthRequest,
  params: { status?: string; patientId?: string; limit?: string; offset?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 200);
  const off = parseInt(params.offset ?? "0") || 0;
  const conditions: any[] = [isNull(xrayRecordsTable.deletedAt)];

  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (allowed.length === 0) return [];
    conditions.push(inArray(xrayRecordsTable.patientId, allowed));
  }

  if (params.status) conditions.push(eq(xrayRecordsTable.status, params.status as any));
  if (params.patientId) {
    const pid = safeParseInt(params.patientId);
    if (!pid) throw new ValidationError("Invalid patientId");
    conditions.push(eq(xrayRecordsTable.patientId, pid));
  }

  const rows = await db.select({
    id: xrayRecordsTable.id,
    patientId: xrayRecordsTable.patientId,
    requestedById: xrayRecordsTable.requestedById,
    performedById: xrayRecordsTable.performedById,
    bodyPart: xrayRecordsTable.bodyPart,
    imageUrl: xrayRecordsTable.imageUrl,
    report: xrayRecordsTable.report,
    status: xrayRecordsTable.status,
    notes: xrayRecordsTable.notes,
    createdAt: xrayRecordsTable.createdAt,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName },
    requestedBy: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(xrayRecordsTable)
    .leftJoin(patientsTable, eq(xrayRecordsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(xrayRecordsTable.requestedById, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(xrayRecordsTable.createdAt))
    .limit(lim).offset(off);

  void logAudit(req, "READ_LIST", "xray", undefined, { count: rows.length });
  return rows;
}

export async function createXray(
  req: AuthRequest,
  data: { patientId: number; requestedById: number; bodyPart: string; notes?: string; appointmentId?: number },
) {
  if (!data.patientId || !data.requestedById || !data.bodyPart) {
    throw new ValidationError("Missing required fields");
  }
  const [xray] = await db.insert(xrayRecordsTable).values({
    patientId: data.patientId, requestedById: data.requestedById, bodyPart: data.bodyPart,
    notes: data.notes, appointmentId: data.appointmentId ?? null,
  }).returning();
  await logAudit(req, "CREATE", "xray", xray.id);
  return xray;
}

export async function getXray(req: AuthRequest, xrayId: number) {
  const [xray] = await db.select().from(xrayRecordsTable).where(eq(xrayRecordsTable.id, xrayId));
  if (!xray) throw new NotFoundError("xray record", xrayId);

  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (!allowed.includes(xray.patientId)) throw new ForbiddenError();
  }

  void logRead(req, "xray", xrayId);
  return xray;
}

export async function updateXray(
  req: AuthRequest,
  xrayId: number,
  data: { imageUrl?: string; imageFileName?: string; report?: string; status?: string; performedById?: number },
) {
  const [xray] = await db.update(xrayRecordsTable)
    .set({ ...data, status: data.status as any, updatedAt: new Date() })
    .where(eq(xrayRecordsTable.id, xrayId))
    .returning();
  if (!xray) throw new NotFoundError("xray record", xrayId);

  if (data.status === "reviewed") {
    const notifData = {
      userId: xray.requestedById,
      title: "X-Ray Report Ready",
      message: `X-ray report for ${xray.bodyPart} is ready for review`,
      type: "xray_ready" as const,
    };
    const [notif] = await db.insert(notificationsTable).values(notifData).returning().catch(() => [null]);
    if (notif) emitToUser(xray.requestedById, "notification", notif);
  }

  await logAudit(req, "UPDATE", "xray", xray.id);
  return xray;
}
