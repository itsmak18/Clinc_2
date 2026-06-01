// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { xrayRecordsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, isNull, desc, lt, and, inArray } from "drizzle-orm";
import { logAudit, logRead } from "../lib/audit";
import { emitToUser } from "../lib/sse";
import { isDoctorScoped, getDoctorPatientScope } from "../lib/scope";
import { NotFoundError, ForbiddenError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

export async function listXrays(
  req: AuthRequest,
  params: { status?: string; patientId?: string; limit?: string; cursor?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 100);
  const conditions: any[] = [isNull(xrayRecordsTable.deletedAt), eq(xrayRecordsTable.clinicId, req.user!.clinicId)];

  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (allowed.length === 0) return { data: [], nextCursor: null };
    conditions.push(inArray(xrayRecordsTable.patientId, allowed));
  }

  if (params.status) conditions.push(eq(xrayRecordsTable.status, params.status as any));
  if (params.patientId) {
    const pid = parseInt(params.patientId);
    if (!isNaN(pid)) conditions.push(eq(xrayRecordsTable.patientId, pid));
  }
  if (params.cursor) {
    const cursorId = parseInt(params.cursor);
    if (!isNaN(cursorId)) conditions.push(lt(xrayRecordsTable.id, cursorId));
  }

  const rows = await runInTenantContext(req.user!, async (tx) =>
    tx.select({
      id: xrayRecordsTable.id,
      patientId: xrayRecordsTable.patientId,
      requestedById: xrayRecordsTable.requestedById,
      performedById: xrayRecordsTable.performedById,
      bodyPart: xrayRecordsTable.bodyPart,
      bodyPartAr: xrayRecordsTable.bodyPartAr,
      imageUrl: xrayRecordsTable.imageUrl,
      report: xrayRecordsTable.report,
      reportAr: xrayRecordsTable.reportAr,
      status: xrayRecordsTable.status,
      notes: xrayRecordsTable.notes,
      notesAr: xrayRecordsTable.notesAr,
      createdAt: xrayRecordsTable.createdAt,
      patient: { id: patientsTable.id, fullName: patientsTable.fullName },
      requestedBy: { id: usersTable.id, fullName: usersTable.fullName },
    }).from(xrayRecordsTable)
      .leftJoin(patientsTable, eq(xrayRecordsTable.patientId, patientsTable.id))
      .leftJoin(usersTable, eq(xrayRecordsTable.requestedById, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(xrayRecordsTable.id))
      .limit(lim),
  );

  const nextCursor = rows.length === lim ? rows[rows.length - 1].id : null;
  void logAudit(req, "READ_LIST", "xray", undefined, { count: rows.length });
  return { data: rows, nextCursor };
}

export async function createXray(
  req: AuthRequest,
  data: { patientId: number | string; requestedById: number | string; bodyPart: string; bodyPartAr?: string; notes?: string; notesAr?: string; appointmentId?: number | string },
) {
  if (!data.patientId || !data.requestedById || !data.bodyPart) {
    throw new ValidationError("Missing required fields");
  }
  const [xray] = await db.insert(xrayRecordsTable).values({
    clinicId: req.user!.clinicId,
    patientId: Number(data.patientId), requestedById: Number(data.requestedById), bodyPart: data.bodyPart,
    bodyPartAr: data.bodyPartAr,
    notes: data.notes, notesAr: data.notesAr,
    appointmentId: data.appointmentId != null ? Number(data.appointmentId) : null,
  }).returning();
  await logAudit(req, "CREATE", "xray", xray.id);
  return xray;
}

export async function getXray(req: AuthRequest, xrayId: number) {
  const xray = await runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(xrayRecordsTable.id, xrayId), eq(xrayRecordsTable.clinicId, req.user!.clinicId)];
    const [row] = await tx.select().from(xrayRecordsTable).where(and(...conditions));
    return row;
  });
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
  data: { imageUrl?: string; imageFileName?: string; report?: string; reportAr?: string; status?: string; performedById?: number; notes?: string; notesAr?: string; bodyPartAr?: string },
) {
  const conditions: any[] = [eq(xrayRecordsTable.id, xrayId), eq(xrayRecordsTable.clinicId, req.user!.clinicId)];
  const [xray] = await db.update(xrayRecordsTable)
    .set({ ...data, status: data.status as any, updatedAt: new Date() })
    .where(and(...conditions))
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
