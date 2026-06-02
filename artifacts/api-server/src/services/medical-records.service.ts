// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { medicalRecordsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, lt, and, inArray } from "drizzle-orm";
import { logAudit, logRead, auditSnapshot } from "../lib/audit";
import { isDoctorScoped, getDoctorPatientScope, assertMedicalRecordInScope } from "../lib/scope";
import { vitalsSchema } from "../lib/jsonb-schemas";
import { encrypt, decrypt, encryptJsonNullable, decryptJsonNullable } from "../lib/field-encryption";
import { hasActiveConsent } from "./consent.service";
import { NotFoundError, ForbiddenError, ValidationError, ConsentRequiredError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

// Decrypt PHI fields on every record returned from the DB.
function decryptRecord<T extends { diagnosis: string; vitals: unknown }>(record: T): T {
  return {
    ...record,
    diagnosis: decrypt(record.diagnosis),
    vitals: decryptJsonNullable(record.vitals as string | null),
  };
}

export async function listMedicalRecords(
  req: AuthRequest,
  params: { patientId?: string; doctorId?: string; limit?: string; cursor?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 100);
  const conditions: any[] = [isNull(medicalRecordsTable.deletedAt), eq(medicalRecordsTable.clinicId, req.user!.clinicId)];

  if (isDoctorScoped(req.user?.role)) {
    const allowed = await getDoctorPatientScope(req.user!.userId);
    if (allowed.length === 0) {
      void logAudit(req, "READ_LIST", "medical_record", undefined, { count: 0 });
      return { data: [], nextCursor: null };
    }
    conditions.push(inArray(medicalRecordsTable.patientId, allowed));
  }

  if (params.patientId) {
    const pid = parseInt(params.patientId);
    if (!isNaN(pid)) conditions.push(eq(medicalRecordsTable.patientId, pid));
  }
  if (params.doctorId) {
    const did = parseInt(params.doctorId);
    if (!isNaN(did)) conditions.push(eq(medicalRecordsTable.doctorId, did));
  }
  if (params.cursor) {
    const cursorId = parseInt(params.cursor);
    if (!isNaN(cursorId)) conditions.push(lt(medicalRecordsTable.id, cursorId));
  }

  const results = await runInTenantContext(req.user!, async (tx) =>
    tx.select({
      id: medicalRecordsTable.id,
      patientId: medicalRecordsTable.patientId,
      doctorId: medicalRecordsTable.doctorId,
      appointmentId: medicalRecordsTable.appointmentId,
      chiefComplaint: medicalRecordsTable.chiefComplaint,
      chiefComplaintAr: medicalRecordsTable.chiefComplaintAr,
      diagnosis: medicalRecordsTable.diagnosis,
      diagnosisAr: medicalRecordsTable.diagnosisAr,
      treatment: medicalRecordsTable.treatment,
      treatmentAr: medicalRecordsTable.treatmentAr,
      notes: medicalRecordsTable.notes,
      vitals: medicalRecordsTable.vitals,
      createdAt: medicalRecordsTable.createdAt,
      patient: { id: patientsTable.id, fullName: patientsTable.fullName },
      doctor: { id: usersTable.id, fullName: usersTable.fullName },
    }).from(medicalRecordsTable)
      .leftJoin(patientsTable, eq(medicalRecordsTable.patientId, patientsTable.id))
      .leftJoin(usersTable, eq(medicalRecordsTable.doctorId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(medicalRecordsTable.id))
      .limit(lim),
  );

  const nextCursor = results.length === lim ? results[results.length - 1].id : null;
  void logAudit(req, "READ_LIST", "medical_record", undefined, { count: results.length });
  return { data: results.map(r => decryptRecord(r)), nextCursor };
}

export async function createMedicalRecord(
  req: AuthRequest,
  data: {
    patientId: unknown;
    doctorId: unknown;
    appointmentId?: string;
    chiefComplaint: string;
    chiefComplaintAr?: string;
    diagnosis: string;
    diagnosisAr?: string;
    treatment: string;
    treatmentAr?: string;
    notes?: string;
    vitals?: unknown;
  },
) {
  if (!data.patientId || !data.doctorId || !data.chiefComplaint || !data.diagnosis || !data.treatment) {
    throw new ValidationError("Missing required fields: patientId, doctorId, chiefComplaint, diagnosis, treatment");
  }

  const parsedVitals = vitalsSchema.safeParse(data.vitals);
  if (!parsedVitals.success) throw new ValidationError("Invalid vitals");

  const pid = Number(data.patientId);
  const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable).where(eq(patientsTable.id, pid));
  if (!patient) throw new NotFoundError("patient", String(pid));

  if (!await hasActiveConsent(pid, "treatment")) {
    throw new ConsentRequiredError("treatment consent is required before creating a medical record");
  }

  const did = Number(data.doctorId);
  const [doctor] = await db.select({ id: usersTable.id, role: usersTable.role }).from(usersTable).where(eq(usersTable.id, did));
  if (!doctor || doctor.role !== "doctor") throw new ValidationError("doctorId must reference a user with doctor role");

  const [record] = await db.insert(medicalRecordsTable).values({
    clinicId: req.user!.clinicId,
    patientId: pid, doctorId: did, appointmentId: data.appointmentId !== undefined ? Number(data.appointmentId) : undefined,
    chiefComplaint: data.chiefComplaint,
    chiefComplaintAr: data.chiefComplaintAr,
    diagnosis: encrypt(data.diagnosis),
    diagnosisAr: data.diagnosisAr,
    treatment: data.treatment, treatmentAr: data.treatmentAr, notes: data.notes,
    vitals: encryptJsonNullable(parsedVitals.data ?? null),
  }).returning();

  await logAudit(req, "CREATE", "medical_record", record.id);
  return decryptRecord(record);
}

export async function getMedicalRecord(req: AuthRequest, recordId: number) {
  await assertMedicalRecordInScope(req, recordId);
  const record = await runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(medicalRecordsTable.id, recordId), eq(medicalRecordsTable.clinicId, req.user!.clinicId)];
    const [row] = await tx.select().from(medicalRecordsTable).where(and(...conditions));
    return row;
  });
  if (!record) throw new NotFoundError("medical record", recordId);

  void logRead(req, "medical_record", recordId);
  return decryptRecord(record);
}

export async function updateMedicalRecord(
  req: AuthRequest,
  recordId: number,
  body: Record<string, any>,
) {
  const conditions: any[] = [eq(medicalRecordsTable.id, recordId), eq(medicalRecordsTable.clinicId, req.user!.clinicId)];

  const [existing] = await db.select().from(medicalRecordsTable).where(and(...conditions));
  if (!existing) throw new NotFoundError("medical record", recordId);

  const role = req.user!.role;
  const isAdmin = ["super_admin", "admin"].includes(role);

  if (role === "nurse") {
    const parsedVitals = vitalsSchema.safeParse(body.vitals);
    if (!parsedVitals.success) throw new ValidationError("Invalid vitals");
    const [record] = await db.update(medicalRecordsTable)
      .set({ vitals: encryptJsonNullable(parsedVitals.data ?? null), updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    await logAudit(req, "UPDATE", "medical_record", record.id, { fields: ["vitals"] });
    return decryptRecord(record);
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
      chiefComplaint: body.chiefComplaint,
      chiefComplaintAr: body.chiefComplaintAr,
      diagnosis: encrypt(body.diagnosis),
      diagnosisAr: body.diagnosisAr,
      treatment: body.treatment, treatmentAr: body.treatmentAr, notes: body.notes,
      vitals: encryptJsonNullable(parsedVitals.data ?? null),
      updatedAt: new Date(),
    })
    .where(and(...conditions))
    .returning();

  if (!record) throw new NotFoundError("medical record", recordId);
  // auditSnapshot redacts encrypted PHI (diagnosis, vitals) and avoids dumping
  // rotating-IV ciphertext into before/after.
  await logAudit(req, "UPDATE", "medical_record", record.id, null, auditSnapshot(existing), auditSnapshot(record));
  return decryptRecord(record);
}

