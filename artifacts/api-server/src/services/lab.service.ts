import { db } from "@workspace/db";
import { labTestsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, isNull, desc, and, inArray } from "drizzle-orm";
import { logAudit, logRead } from "../lib/audit";
import { safeParseInt } from "../lib/validators";
import { emitToUser } from "../lib/sse";
import { isDoctorScoped, getDoctorPatientScope } from "../lib/scope";
import { NotFoundError, ForbiddenError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

export async function listLabTests(
  req: AuthRequest,
  params: { status?: string; patientId?: string; limit?: string; offset?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 200);
  const off = parseInt(params.offset ?? "0") || 0;
  const conditions: any[] = [isNull(labTestsTable.deletedAt)];

  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (allowed.length === 0) return [];
    conditions.push(inArray(labTestsTable.patientId, allowed));
  }

  if (params.status) conditions.push(eq(labTestsTable.status, params.status as any));
  if (params.patientId) {
    const pid = safeParseInt(params.patientId);
    if (!pid) throw new ValidationError("Invalid patientId");
    conditions.push(eq(labTestsTable.patientId, pid));
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
    .orderBy(desc(labTestsTable.createdAt))
    .limit(lim).offset(off);

  void logAudit(req, "READ_LIST", "lab_test", undefined, { count: rows.length });
  return rows;
}

export async function createLabTest(
  req: AuthRequest,
  data: { patientId: number; requestedById: number; testName: string; notes?: string; appointmentId?: number },
) {
  if (!data.patientId || !data.requestedById || !data.testName) {
    throw new ValidationError("Missing required fields");
  }
  const [test] = await db.insert(labTestsTable).values({
    patientId: data.patientId, requestedById: data.requestedById, testName: data.testName,
    notes: data.notes, appointmentId: data.appointmentId ?? null,
  }).returning();
  await logAudit(req, "CREATE", "lab_test", test.id);
  return test;
}

export async function getLabTest(req: AuthRequest, testId: number) {
  const [test] = await db.select().from(labTestsTable).where(eq(labTestsTable.id, testId));
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
  const [test] = await db.update(labTestsTable)
    .set({ results: data.results, status: data.status as any, performedById: data.performedById, updatedAt: new Date() })
    .where(eq(labTestsTable.id, testId))
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
