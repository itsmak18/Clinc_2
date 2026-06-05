// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { labTestsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, isNull, desc, lt, and, inArray } from "drizzle-orm";
import { logAudit, logRead } from "../lib/audit";
import { emitToUser } from "../lib/sse";
import { isDoctorScoped, getDoctorPatientScope, getDoctorListScope } from "../lib/scope";
import { getActiveBreakGlassPatientIds } from "./break-glass.service";
import { NotFoundError, ForbiddenError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

export async function listLabTests(
  req: AuthRequest,
  params: { status?: string; patientId?: string; limit?: string; cursor?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 100);
  const conditions: any[] = [isNull(labTestsTable.deletedAt), eq(labTestsTable.clinicId, req.user!.clinicId)];

  let breakGlassPatientIds: number[] = [];
  if (isDoctorScoped(req.user?.role)) {
    const scope = await getDoctorListScope(req, "lab_test");
    breakGlassPatientIds = scope.breakGlassPatientIds;
    if (scope.allowed.length === 0) return { data: [], nextCursor: null };
    conditions.push(inArray(labTestsTable.patientId, scope.allowed));
  }

  if (params.status) conditions.push(eq(labTestsTable.status, params.status as any));
  if (params.patientId) {
    const pid = parseInt(params.patientId);
    if (!isNaN(pid)) conditions.push(eq(labTestsTable.patientId, pid));
  }
  if (params.cursor) {
    const cursorId = parseInt(params.cursor);
    if (!isNaN(cursorId)) conditions.push(lt(labTestsTable.id, cursorId));
  }

  const rows = await runInTenantContext(req.user!, async (tx) =>
    tx.select({
      id: labTestsTable.id,
      patientId: labTestsTable.patientId,
      requestedById: labTestsTable.requestedById,
      performedById: labTestsTable.performedById,
      testName: labTestsTable.testName,
      testNameAr: labTestsTable.testNameAr,
      results: labTestsTable.results,
      resultsAr: labTestsTable.resultsAr,
      status: labTestsTable.status,
      notes: labTestsTable.notes,
      notesAr: labTestsTable.notesAr,
      createdAt: labTestsTable.createdAt,
      patient: { id: patientsTable.id, fullName: patientsTable.fullName },
      requestedBy: { id: usersTable.id, fullName: usersTable.fullName },
    }).from(labTestsTable)
      .leftJoin(patientsTable, eq(labTestsTable.patientId, patientsTable.id))
      .leftJoin(usersTable, eq(labTestsTable.requestedById, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(labTestsTable.id))
      .limit(lim),
    { breakGlassPatientIds },
  );

  const nextCursor = rows.length === lim ? rows[rows.length - 1].id : null;
  void logAudit(req, "READ_LIST", "lab_test", undefined, { count: rows.length });
  return { data: rows, nextCursor };
}

export async function createLabTest(
  req: AuthRequest,
  data: { patientId: number | string; requestedById: number | string; testName: string; testNameAr?: string; notes?: string; notesAr?: string; appointmentId?: number | string },
) {
  if (!data.patientId || !data.requestedById || !data.testName) {
    throw new ValidationError("Missing required fields");
  }
  const [test] = await db.insert(labTestsTable).values({
    clinicId: req.user!.clinicId,
    patientId: Number(data.patientId), requestedById: Number(data.requestedById), testName: data.testName,
    testNameAr: data.testNameAr,
    notes: data.notes, notesAr: data.notesAr,
    appointmentId: data.appointmentId != null ? Number(data.appointmentId) : null,
  }).returning();
  await logAudit(req, "CREATE", "lab_test", test.id);
  return test;
}

export async function getLabTest(req: AuthRequest, testId: number) {
  const isDoc = isDoctorScoped(req.user?.role);
  // Break-glass must be resolved BEFORE the read: doctor_scope RLS (0017) would
  // otherwise hide a non-assigned patient's row and surface a misleading 404.
  const breakGlassPatientIds = isDoc
    ? await getActiveBreakGlassPatientIds(req.user!.userId, req.user!.clinicId)
    : [];

  const test = await runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(labTestsTable.id, testId), eq(labTestsTable.clinicId, req.user!.clinicId)];
    const [row] = await tx.select().from(labTestsTable).where(and(...conditions));
    return row;
  }, { breakGlassPatientIds });
  if (!test) throw new NotFoundError("lab test", testId);

  if (isDoc) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    const viaBreakGlass = breakGlassPatientIds.includes(test.patientId);
    if (!allowed.includes(test.patientId) && !viaBreakGlass) throw new ForbiddenError();
    if (viaBreakGlass) {
      await logAudit(req, "BREAK_GLASS_ACCESS", "lab_test", testId, { patientId: test.patientId, via: "get" } as object);
    }
  }

  void logRead(req, "lab_test", testId);
  return test;
}

export async function updateLabTest(
  req: AuthRequest,
  testId: number,
  data: { results?: string; resultsAr?: string; status?: string; performedById?: number; notes?: string; notesAr?: string },
) {
  const conditions: any[] = [eq(labTestsTable.id, testId), eq(labTestsTable.clinicId, req.user!.clinicId)];
  const [test] = await db.update(labTestsTable)
    .set({ results: data.results, resultsAr: data.resultsAr, status: data.status as any, performedById: data.performedById, notes: data.notes, notesAr: data.notesAr, updatedAt: new Date() })
    .where(and(...conditions))
    .returning();
  if (!test) throw new NotFoundError("lab test", testId);

  if (data.status === "completed") {
    const notifData = {
      userId: test.requestedById,
      title: "Lab Results Ready",
      message: `${test.testName} results are ready for review`,
      type: "lab_ready" as const,
    };
    const [notif] = await db.insert(notificationsTable).values(notifData).returning().catch(() => [null]);
    if (notif) emitToUser(test.requestedById, "notification", notif);
  }

  await logAudit(req, "UPDATE", "lab_test", test.id);
  return test;
}
