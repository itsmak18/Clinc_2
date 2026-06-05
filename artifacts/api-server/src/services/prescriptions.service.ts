// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { prescriptionsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc, lt, and, inArray } from "drizzle-orm";
import { logAudit, logRead, auditSnapshot } from "../lib/audit";
import { isDoctorScoped, getDoctorListScope } from "../lib/scope";
import { getActiveBreakGlassPatientIds } from "./break-glass.service";
import { medicationsSchema } from "../lib/jsonb-schemas";
import { encryptJson, decryptJson, isEncrypted } from "../lib/field-encryption";
import { hasActiveConsent } from "./consent.service";
import { NotFoundError, ValidationError, ConsentRequiredError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

function decryptPrescription<T extends { medications: unknown }>(row: T): T {
  const raw = row.medications;
  if (typeof raw === "string" && isEncrypted(raw)) {
    return { ...row, medications: decryptJson(raw) };
  }
  return row;
}

export async function listPrescriptions(
  req: AuthRequest,
  params: { patientId?: string; limit?: string; cursor?: string },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 100);
  const conditions: any[] = [isNull(prescriptionsTable.deletedAt), eq(prescriptionsTable.clinicId, req.user!.clinicId)];

  let breakGlassPatientIds: number[] = [];
  if (isDoctorScoped(req.user?.role)) {
    const scope = await getDoctorListScope(req, "prescription");
    breakGlassPatientIds = scope.breakGlassPatientIds;
    if (scope.allowed.length === 0) return { data: [], nextCursor: null };
    conditions.push(inArray(prescriptionsTable.patientId, scope.allowed));
  }

  if (params.patientId) {
    const pid = parseInt(params.patientId);
    if (!isNaN(pid)) conditions.push(eq(prescriptionsTable.patientId, pid));
  }
  if (params.cursor) {
    const cursorId = parseInt(params.cursor);
    if (!isNaN(cursorId)) conditions.push(lt(prescriptionsTable.id, cursorId));
  }

  const rows = await runInTenantContext(req.user!, async (tx) =>
    tx.select({
      id: prescriptionsTable.id,
      patientId: prescriptionsTable.patientId,
      doctorId: prescriptionsTable.doctorId,
      recordId: prescriptionsTable.recordId,
      medications: prescriptionsTable.medications,
      notes: prescriptionsTable.notes,
      notesAr: prescriptionsTable.notesAr,
      createdAt: prescriptionsTable.createdAt,
      patient: { id: patientsTable.id, fullName: patientsTable.fullName },
      doctor: { id: usersTable.id, fullName: usersTable.fullName },
    }).from(prescriptionsTable)
      .leftJoin(patientsTable, eq(prescriptionsTable.patientId, patientsTable.id))
      .leftJoin(usersTable, eq(prescriptionsTable.doctorId, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(prescriptionsTable.id))
      .limit(lim),
    { breakGlassPatientIds },
  );

  const nextCursor = rows.length === lim ? rows[rows.length - 1].id : null;
  void logAudit(req, "READ_LIST", "prescription", undefined, { count: rows.length });
  return { data: rows.map(r => decryptPrescription(r)), nextCursor };
}

export async function createPrescription(
  req: AuthRequest,
  data: { patientId: unknown; doctorId: string; recordId?: string; medications: unknown; notes?: string; notesAr?: string },
) {
  if (!data.patientId || !data.doctorId) {
    throw new ValidationError("Missing required fields: patientId, doctorId, medications");
  }

  const parsedMeds = medicationsSchema.safeParse(data.medications);
  if (!parsedMeds.success) throw Object.assign(new ValidationError("Invalid medications format"), { status: 422 });

  const pid = Number(data.patientId);

  const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable)
    .where(and(eq(patientsTable.id, pid), isNull(patientsTable.deletedAt)));
  if (!patient) throw new NotFoundError("patient", String(pid));

  if (!await hasActiveConsent(pid, "treatment", req.user!.clinicId)) {
    throw new ConsentRequiredError("treatment consent is required before creating a prescription");
  }

  const [prescription] = await db.insert(prescriptionsTable).values({
    clinicId: req.user!.clinicId,
    patientId: pid, doctorId: Number(data.doctorId), recordId: data.recordId !== undefined ? Number(data.recordId) : undefined,
    medications: encryptJson(parsedMeds.data), notes: data.notes, notesAr: data.notesAr,
  }).returning();

  await logAudit(req, "CREATE", "prescription", prescription.id);
  return decryptPrescription(prescription);
}

export async function getPrescription(req: AuthRequest, id: number) {
  const isDoc = isDoctorScoped(req.user?.role);
  // Doctor scope here is enforced entirely by the doctor_scope RLS policy (this
  // function has no app-layer patient check), so break-glass IDs must be set on
  // the read context or a non-assigned patient's prescription returns a 404.
  const breakGlassPatientIds = isDoc
    ? await getActiveBreakGlassPatientIds(req.user!.userId, req.user!.clinicId)
    : [];

  const prescription = await runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(prescriptionsTable.id, id), isNull(prescriptionsTable.deletedAt), eq(prescriptionsTable.clinicId, req.user!.clinicId)];
    const [row] = await tx.select().from(prescriptionsTable).where(and(...conditions));
    return row;
  }, { breakGlassPatientIds });
  if (!prescription) throw new NotFoundError("prescription", id);

  if (isDoc && breakGlassPatientIds.includes(prescription.patientId)) {
    await logAudit(req, "BREAK_GLASS_ACCESS", "prescription", id, { patientId: prescription.patientId, via: "get" } as object);
  }

  void logRead(req, "prescription", id);
  return decryptPrescription(prescription);
}

export async function voidPrescription(req: AuthRequest, id: number, reason: string) {
  if (!reason) throw new ValidationError("A reason is required to void a prescription");
  const conditions: any[] = [eq(prescriptionsTable.id, id), eq(prescriptionsTable.clinicId, req.user!.clinicId)];
  const [before] = await db.select().from(prescriptionsTable).where(and(...conditions));
  const [after] = await db.update(prescriptionsTable)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(...conditions))
    .returning();
  await logAudit(req, "VOID_PRESCRIPTION", "prescription", id, { reason }, auditSnapshot(before), auditSnapshot(after));
}
