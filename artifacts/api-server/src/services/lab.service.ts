import { db } from "@workspace/db";
import { labTestsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, isNull, desc, lt, and, inArray } from "drizzle-orm";
import { logAudit, logRead } from "../lib/audit";
import { emitToUser } from "../lib/sse";
import { isDoctorScoped, getDoctorPatientScope } from "../lib/scope";
import { NotFoundError, ForbiddenError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

export async function listLabTests(
  req: AuthRequest,
  params: { status?: string; patientId?: string; limit?: string; cursor?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 100);
  const conditions: any[] = [isNull(labTestsTable.deletedAt), eq(labTestsTable.clinicId, req.user!.clinicId)];

  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (allowed.length === 0) return { data: [], nextCursor: null };
    conditions.push(inArray(labTestsTable.patientId, allowed));
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

  const rows = await db.select({
    id: labTestsTable.id,
    patientId: labTestsTable.patientId,
    requestedById: labTestsTable.requestedById,
    performedById: labTestsTable.performedById,
    testName: labTestsTable.testName,
    results: labTestsTable.results,
    status: labTestsTable.status,
    notes: labTestsTable.notes,
    createdAt: labTestsTable.createdAt,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName },
    requestedBy: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(labTestsTable)
    .leftJoin(patientsTable, eq(labTestsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(labTestsTable.requestedById, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(labTestsTable.id))
    .limit(lim);

  const nextCursor = rows.length === lim ? rows[rows.length - 1].id : null;
  void logAudit(req, "READ_LIST", "lab_test", undefined, { count: rows.length });
  return { data: rows, nextCursor };
}

export async function createLabTest(
  req: AuthRequest,
  data: { patientId: number | string; requestedById: number | string; testName: string; notes?: string; appointmentId?: number | string },
) {
  if (!data.patientId || !data.requestedById || !data.testName) {
    throw new ValidationError("Missing required fields");
  }
  const [test] = await db.insert(labTestsTable).values({
    clinicId: req.user!.clinicId,
    patientId: Number(data.patientId), requestedById: Number(data.requestedById), testName: data.testName,
    notes: data.notes, appointmentId: data.appointmentId != null ? Number(data.appointmentId) : null,
  }).returning();
  await logAudit(req, "CREATE", "lab_test", test.id);
  return test;
}

export async function getLabTest(req: AuthRequest, testId: number) {
  const conditions: any[] = [eq(labTestsTable.id, testId), eq(labTestsTable.clinicId, req.user!.clinicId)];
  const [test] = await db.select().from(labTestsTable).where(and(...conditions));
  if (!test) throw new NotFoundError("lab test", testId);

  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (!allowed.includes(test.patientId)) throw new ForbiddenError();
  }

  void logRead(req, "lab_test", testId);
  return test;
}

export async function updateLabTest(
  req: AuthRequest,
  testId: number,
  data: { results?: string; status?: string; performedById?: number },
) {
  const conditions: any[] = [eq(labTestsTable.id, testId), eq(labTestsTable.clinicId, req.user!.clinicId)];
  const [test] = await db.update(labTestsTable)
    .set({ results: data.results, status: data.status as any, performedById: data.performedById, updatedAt: new Date() })
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
