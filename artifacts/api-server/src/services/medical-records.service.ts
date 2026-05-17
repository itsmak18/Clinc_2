import { db } from "@workspace/db";
import { medicalRecordsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, and, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { logAudit, logRead } from "../lib/audit";
import { safeParseInt } from "../lib/validators";
import { isDoctorScoped, getDoctorPatientScope, assertMedicalRecordInScope } from "../lib/scope";
import { vitalsSchema } from "../lib/jsonb-schemas";
import { NotFoundError, ForbiddenError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

export async function listMedicalRecords(
  req: AuthRequest,
  params: { patientId?: string; doctorId?: string },
) {
  const conditions: any[] = [isNull(medicalRecordsTable.deletedAt)];

  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (allowed.length === 0) {
      void logAudit(req, "READ_LIST", "medical_record", undefined, { count: 0 });
      return [];
    }
    conditions.push(inArray(medicalRecordsTable.patientId, allowed));
  }

  if (params.patientId) {
    const pid = safeParseInt(params.patientId);
    if (!pid) throw new ValidationError("Invalid patientId");
    conditions.push(eq(medicalRecordsTable.patientId, pid));
  }
  if (params.doctorId) {
    const did = safeParseInt(params.doctorId);
    if (!did) throw new ValidationError("Invalid doctorId");
    conditions.push(eq(medicalRecordsTable.doctorId, did));
  }

  const results = await db.select({
    id: medicalRecordsTable.id,
    patientId: medicalRecordsTable.patientId,
    doctorId: medicalRecordsTable.doctorId,
    appointmentId: medicalRecordsTable.appointmentId,
    chiefComplaint: medicalRecordsTable.chiefComplaint,
    diagnosis: medicalRecordsTable.diagnosis,
    treatment: medicalRecordsTable.treatment,
    notes: medicalRecordsTable.notes,
    vitals: medicalRecordsTable.vitals,
    isGlobal: medicalRecordsTable.isGlobal,
    createdAt: medicalRecordsTable.createdAt,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName },
    doctor: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(medicalRecordsTable)
    .leftJoin(patientsTable, eq(medicalRecordsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(medicalRecordsTable.doctorId, usersTable.id))
    .where(and(...conditions))
    .orderBy(desc(medicalRecordsTable.createdAt));

  void logAudit(req, "READ_LIST", "medical_record", undefined, { count: results.length });
  return results;
}

export async function createMedicalRecord(
  req: AuthRequest,
  data: {
    patientId: unknown;
    doctorId: unknown;
    appointmentId?: number;
    chiefComplaint: string;
    diagnosis: string;
    treatment: string;
    notes?: string;
    vitals?: unknown;
  },
) {
  if (!data.patientId || !data.doctorId || !data.chiefComplaint || !data.diagnosis || !data.treatment) {
    throw new ValidationError("Missing required fields: patientId, doctorId, chiefComplaint, diagnosis, treatment");
  }

  const parsedVitals = vitalsSchema.safeParse(data.vitals);
  if (!parsedVitals.success) throw new ValidationError("Invalid vitals");

  const pid = safeParseInt(String(data.patientId));
  if (!pid) throw new ValidationError("Invalid patientId");
  const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable).where(eq(patientsTable.id, pid));
  if (!patient) throw new NotFoundError("patient", pid);

  const did = safeParseInt(String(data.doctorId));
  if (!did) throw new ValidationError("Invalid doctorId");
  const [doctor] = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, did));
  if (!doctor || doctor.role !== "doctor") throw new ValidationError("doctorId must reference a user with doctor role");

  const [record] = await db.insert(medicalRecordsTable).values({
    patientId: pid, doctorId: did, appointmentId: data.appointmentId,
    chiefComplaint: data.chiefComplaint, diagnosis: data.diagnosis,
    treatment: data.treatment, notes: data.notes,
    vitals: parsedVitals.data ?? null,
  }).returning();

  await logAudit(req, "CREATE", "medical_record", record.id);
  return record;
}

export async function getMedicalRecord(req: AuthRequest, recordId: number) {
  if (!await assertMedicalRecordInScope(req, recordId)) {
    throw Object.assign(new ForbiddenError("access_denied"), { reason: "record_not_owned_or_global" });
  }
  const [record] = await db.select().from(medicalRecordsTable).where(eq(medicalRecordsTable.id, recordId));
  if (!record) throw new NotFoundError("medical record", recordId);

  void logRead(req, "medical_record", recordId);
  return record;
}

export async function updateMedicalRecord(
  req: AuthRequest,
  recordId: number,
  body: Record<string, any>,
) {
  const [existing] = await db.select().from(medicalRecordsTable).where(eq(medicalRecordsTable.id, recordId));
  if (!existing) throw new NotFoundError("medical record", recordId);

  const role = req.user!.role;
  const isAdmin = ["super_admin", "admin"].includes(role);

  if (role === "nurse") {
    const parsedVitals = vitalsSchema.safeParse(body.vitals);
    if (!parsedVitals.success) throw new ValidationError("Invalid vitals");
    const [record] = await db.update(medicalRecordsTable)
      .set({ vitals: parsedVitals.data ?? null, updatedAt: new Date() })
      .where(eq(medicalRecordsTable.id, recordId))
      .returning();
    await logAudit(req, "UPDATE", "medical_record", record.id, { fields: ["vitals"] });
    return record;
  }

  const isOwner = existing.doctorId === req.user!.userId;
  if (!isOwner && !isAdmin) {
    await logAudit(req, "UNAUTHORIZED_EDIT_ATTEMPT", "medical_record", recordId, {
      ownerId: existing.doctorId, attemptedBy: req.user!.userId,
    });
    throw new ForbiddenError("Only the original doctor or an admin can edit this record");
  }

  const LOCK_WINDOW_MS = 24 * 60 * 60 * 1000;
  const isLocked = Date.now() - new Date(existing.createdAt).getTime() > LOCK_WINDOW_MS;
  if (isLocked && !isAdmin) {
    await logAudit(req, "EDIT_LOCKED_DENIED", "medical_record", existing.id, {
      createdAt: existing.createdAt, attemptedAt: new Date(),
    });
    throw Object.assign(new ForbiddenError("Medical record is read-only after 24 hours."), {
      lockedSince: new Date(new Date(existing.createdAt).getTime() + LOCK_WINDOW_MS),
    });
  }

  const parsedVitals = vitalsSchema.safeParse(body.vitals);
  if (!parsedVitals.success) throw new ValidationError("Invalid vitals");

  const [record] = await db.update(medicalRecordsTable)
    .set({
      chiefComplaint: body.chiefComplaint, diagnosis: body.diagnosis,
      treatment: body.treatment, notes: body.notes,
      vitals: parsedVitals.data ?? null, updatedAt: new Date(),
    })
    .where(eq(medicalRecordsTable.id, recordId))
    .returning();

  if (!record) throw new NotFoundError("medical record", recordId);
  await logAudit(req, "UPDATE", "medical_record", record.id, { before: existing, after: record });
  return record;
}

const globalFlagSchema = z.object({
  isGlobal: z.boolean(),
  reason: z.string().min(20),
});

export async function setGlobalFlag(req: AuthRequest, recordId: number, body: unknown) {
  const parsed = globalFlagSchema.safeParse(body);
  if (!parsed.success) throw new ValidationError("reason must be at least 20 characters");

  const [existing] = await db.select({ id: medicalRecordsTable.id }).from(medicalRecordsTable)
    .where(and(eq(medicalRecordsTable.id, recordId), isNull(medicalRecordsTable.deletedAt)));
  if (!existing) throw new NotFoundError("medical record", recordId);

  const [record] = await db.update(medicalRecordsTable)
    .set({ isGlobal: parsed.data.isGlobal, globalReason: parsed.data.reason, updatedAt: new Date() })
    .where(eq(medicalRecordsTable.id, recordId))
    .returning();

  await logAudit(req, "UPDATE", "medical_record", record.id, {
    isGlobal: parsed.data.isGlobal, reason: parsed.data.reason,
  });
  return record;
}
