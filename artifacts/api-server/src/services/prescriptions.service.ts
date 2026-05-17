import { db } from "@workspace/db";
import { prescriptionsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, and, inArray } from "drizzle-orm";
import { logAudit, logRead } from "../lib/audit";
import { safeParseInt } from "../lib/validators";
import { isDoctorScoped, getDoctorPatientScope } from "../lib/scope";
import { medicationsSchema } from "../lib/jsonb-schemas";
import { NotFoundError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

export async function listPrescriptions(
  req: AuthRequest,
  params: { patientId?: string; limit?: string; offset?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 200);
  const off = parseInt(params.offset ?? "0") || 0;
  const conditions: any[] = [isNull(prescriptionsTable.deletedAt)];

  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (allowed.length === 0) return [];
    conditions.push(inArray(prescriptionsTable.patientId, allowed));
  }

  if (params.patientId) {
    const pid = safeParseInt(params.patientId);
    if (!pid) throw new ValidationError("Invalid patientId");
    conditions.push(eq(prescriptionsTable.patientId, pid));
  }

  return db.select({
    id: prescriptionsTable.id,
    patientId: prescriptionsTable.patientId,
    doctorId: prescriptionsTable.doctorId,
    recordId: prescriptionsTable.recordId,
    medications: prescriptionsTable.medications,
    notes: prescriptionsTable.notes,
    createdAt: prescriptionsTable.createdAt,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName },
    doctor: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(prescriptionsTable)
    .leftJoin(patientsTable, eq(prescriptionsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(prescriptionsTable.doctorId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(prescriptionsTable.createdAt))
    .limit(lim).offset(off);
}

export async function createPrescription(
  req: AuthRequest,
  data: { patientId: unknown; doctorId: number; recordId?: number; medications: unknown; notes?: string },
) {
  if (!data.patientId || !data.doctorId) {
    throw new ValidationError("Missing required fields: patientId, doctorId, medications");
  }

  const parsedMeds = medicationsSchema.safeParse(data.medications);
  if (!parsedMeds.success) throw Object.assign(new ValidationError("Invalid medications format"), { status: 422 });

  const pid = safeParseInt(String(data.patientId));
  if (!pid) throw new ValidationError("Invalid patientId");

  const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable)
    .where(and(eq(patientsTable.id, pid), isNull(patientsTable.deletedAt)));
  if (!patient) throw new NotFoundError("patient", pid);

  const [prescription] = await db.insert(prescriptionsTable).values({
    patientId: pid, doctorId: data.doctorId, recordId: data.recordId,
    medications: parsedMeds.data, notes: data.notes,
  }).returning();

  await logAudit(req, "CREATE", "prescription", prescription.id);
  return prescription;
}

export async function getPrescription(req: AuthRequest, id: number) {
  const [prescription] = await db.select().from(prescriptionsTable)
    .where(and(eq(prescriptionsTable.id, id), isNull(prescriptionsTable.deletedAt)));
  if (!prescription) throw new NotFoundError("prescription", id);
  void logRead(req, "prescription", id);
  return prescription;
}

export async function voidPrescription(req: AuthRequest, id: number, reason: string) {
  if (!reason) throw new ValidationError("A reason is required to void a prescription");
  await db.update(prescriptionsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(prescriptionsTable.id, id));
  await logAudit(req, "VOID_PRESCRIPTION", "prescription", id, { reason });
}
