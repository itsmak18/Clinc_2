// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { ultrasoundRecordsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, isNull, desc, lt, and, inArray } from "drizzle-orm";
import { logAudit, logRead } from "../lib/audit";
import { emitToUser } from "../lib/sse";
import { isDoctorScoped, getDoctorPatientScope, getDoctorListScope } from "../lib/scope";
import { getActiveBreakGlassPatientIds } from "./break-glass.service";
import { NotFoundError, ForbiddenError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

export async function listUltrasounds(
  req: AuthRequest,
  params: { status?: string; patientId?: string; limit?: string; cursor?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 100);
  const conditions: any[] = [isNull(ultrasoundRecordsTable.deletedAt), eq(ultrasoundRecordsTable.clinicId, req.user!.clinicId)];

  let breakGlassPatientIds: number[] = [];
  if (isDoctorScoped(req.user?.role)) {
    const scope = await getDoctorListScope(req, "ultrasound");
    breakGlassPatientIds = scope.breakGlassPatientIds;
    if (scope.allowed.length === 0) {
      void logAudit(req, "READ_LIST", "ultrasound", undefined, { count: 0 });
      return { data: [], nextCursor: null };
    }
    conditions.push(inArray(ultrasoundRecordsTable.patientId, scope.allowed));
  }

  if (params.status) conditions.push(eq(ultrasoundRecordsTable.status, params.status as any));
  if (params.patientId) {
    const pid = parseInt(params.patientId);
    if (!isNaN(pid)) conditions.push(eq(ultrasoundRecordsTable.patientId, pid));
  }
  if (params.cursor) {
    const cursorId = parseInt(params.cursor);
    if (!isNaN(cursorId)) conditions.push(lt(ultrasoundRecordsTable.id, cursorId));
  }

  const rows = await runInTenantContext(req.user!, async (tx) =>
    tx.select({
      id: ultrasoundRecordsTable.id,
      patientId: ultrasoundRecordsTable.patientId,
      requestedById: ultrasoundRecordsTable.requestedById,
      performedById: ultrasoundRecordsTable.performedById,
      examType: ultrasoundRecordsTable.examType,
      bodyPart: ultrasoundRecordsTable.bodyPart,
      bodyPartAr: ultrasoundRecordsTable.bodyPartAr,
      imageUrl: ultrasoundRecordsTable.imageUrl,
      report: ultrasoundRecordsTable.report,
      reportAr: ultrasoundRecordsTable.reportAr,
      status: ultrasoundRecordsTable.status,
      notes: ultrasoundRecordsTable.notes,
      notesAr: ultrasoundRecordsTable.notesAr,
      createdAt: ultrasoundRecordsTable.createdAt,
      patient: { id: patientsTable.id, fullName: patientsTable.fullName },
      requestedBy: { id: usersTable.id, fullName: usersTable.fullName },
    }).from(ultrasoundRecordsTable)
      .leftJoin(patientsTable, eq(ultrasoundRecordsTable.patientId, patientsTable.id))
      .leftJoin(usersTable, eq(ultrasoundRecordsTable.requestedById, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(ultrasoundRecordsTable.id))
      .limit(lim),
    { breakGlassPatientIds },
  );

  const nextCursor = rows.length === lim ? rows[rows.length - 1].id : null;
  void logAudit(req, "READ_LIST", "ultrasound", undefined, { count: rows.length });
  return { data: rows, nextCursor };
}

export async function createUltrasound(
  req: AuthRequest,
  data: { patientId: number | string; requestedById: number | string; examType: string; bodyPart: string; bodyPartAr?: string; notes?: string; notesAr?: string },
) {
  if (!data.patientId || !data.requestedById || !data.examType || !data.bodyPart) {
    throw new ValidationError("Missing required fields");
  }
  const [record] = await db.insert(ultrasoundRecordsTable).values({
    clinicId: req.user!.clinicId,
    patientId: Number(data.patientId), requestedById: Number(data.requestedById),
    examType: data.examType as any, bodyPart: data.bodyPart, bodyPartAr: data.bodyPartAr, notes: data.notes, notesAr: data.notesAr,
  }).returning();
  await logAudit(req, "CREATE", "ultrasound", record.id);
  return record;
}

export async function getUltrasound(req: AuthRequest, id: number) {
  const isDoc = isDoctorScoped(req.user?.role);
  const breakGlassPatientIds = isDoc
    ? await getActiveBreakGlassPatientIds(req.user!.userId, req.user!.clinicId)
    : [];

  const record = await runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(ultrasoundRecordsTable.id, id), eq(ultrasoundRecordsTable.clinicId, req.user!.clinicId)];
    const [row] = await tx.select().from(ultrasoundRecordsTable).where(and(...conditions));
    return row;
  }, { breakGlassPatientIds });
  if (!record) throw new NotFoundError("ultrasound record", id);

  if (isDoc) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    const viaBreakGlass = breakGlassPatientIds.includes(record.patientId);
    if (!allowed.includes(record.patientId) && !viaBreakGlass) throw new ForbiddenError();
    if (viaBreakGlass) {
      await logAudit(req, "BREAK_GLASS_ACCESS", "ultrasound", id, { patientId: record.patientId, via: "get" } as object);
    }
  }

  void logRead(req, "ultrasound", id);
  return record;
}

export async function updateUltrasound(
  req: AuthRequest,
  id: number,
  data: { imageUrl?: string; imageFileName?: string; report?: string; reportAr?: string; status?: string; performedById?: number; notes?: string; notesAr?: string; bodyPartAr?: string },
) {
  const conditions: any[] = [eq(ultrasoundRecordsTable.id, id), eq(ultrasoundRecordsTable.clinicId, req.user!.clinicId)];
  const [record] = await db.update(ultrasoundRecordsTable)
    .set({ ...data, status: data.status as any, updatedAt: new Date() })
    .where(and(...conditions))
    .returning();
  if (!record) throw new NotFoundError("ultrasound record", id);

  if (data.status === "reviewed") {
    const notifData = {
      userId: record.requestedById,
      title: "Ultrasound Report Ready",
      message: `Ultrasound report for ${record.examType} â€” ${record.bodyPart} is ready for review`,
      type: "ultrasound_ready" as const,
    };
    const [notif] = await db.insert(notificationsTable).values(notifData).returning().catch(() => [null]);
    if (notif) emitToUser(record.requestedById, "notification", notif);
  }

  await logAudit(req, "UPDATE", "ultrasound", record.id);
  return record;
}
