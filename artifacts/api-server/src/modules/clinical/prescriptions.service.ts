// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { prescriptionsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, isNull, desc, lt, and, inArray } from "drizzle-orm";
import { emitToUser } from "../../lib/sse";
import { logAudit, logRead, auditSnapshot } from "../../lib/audit";
import { isDoctorScoped, getDoctorListScope } from "../../lib/scope";
import { getActiveBreakGlassPatientIds, hasActiveConsent } from "../compliance";
import { auditBreakGlass } from "../../lib/break-glass-audit";
import { medicationsSchema } from "../../lib/jsonb-schemas";
import { encryptJson, decryptJson, isEncrypted, decryptNullable } from "../../lib/field-encryption";
import { NotFoundError, ValidationError, ConsentRequiredError } from "../../services/errors";
import type { AuthRequest } from "../../middlewares/auth";

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
      patient: { id: patientsTable.id, fullName: patientsTable.fullName, mrn: patientsTable.mrn, dateOfBirth: patientsTable.dateOfBirth, gender: patientsTable.gender },
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
  await logAudit(req, "READ_LIST", "prescription", undefined, { count: rows.length });
  return { data: rows.map(r => decryptPrescription(r)), nextCursor };
}

export async function createPrescription(
  req: AuthRequest,
  data: { patientId: unknown; doctorId: string; recordId?: string; medications: unknown; notes?: string; notesAr?: string },
) {
  // Presence of patientId/doctorId is validated at the route by
  // validate(CreatePrescriptionBody); medications shape is guarded below.
  const parsedMeds = medicationsSchema.safeParse(data.medications);
  if (!parsedMeds.success) throw Object.assign(new ValidationError("Invalid medications format"), { status: 422 });

  const pid = Number(data.patientId);

  const [patient] = await db
    .select({ id: patientsTable.id, allergies: patientsTable.allergies })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, pid), eq(patientsTable.clinicId, req.user!.clinicId), isNull(patientsTable.deletedAt)));
  if (!patient) throw new NotFoundError("patient", String(pid));

  if (!await hasActiveConsent(pid, "treatment", req.user!.clinicId)) {
    throw new ConsentRequiredError("treatment consent is required before creating a prescription");
  }

  // Allergy contraindication check: compare medication names against the patient's
  // decrypted allergies field using case-insensitive word boundary matching.
  // No external drug DB — relies on the doctor having entered medication names in
  // allergies (e.g., "Penicillin, Sulfa"). Override: clear the allergy record or
  // use a non-overlapping name. Flagged hits raise ValidationError; if the doctor
  // intends to prescribe despite the allergy, they must document it in the record.
  const allergyText = decryptNullable(patient.allergies ?? null);
  if (allergyText) {
    const allergyTokens = allergyText
      .toLowerCase()
      .split(/[\s,;/]+/)
      .map(t => t.trim())
      .filter(t => t.length >= 3);
    const flagged = parsedMeds.data
      .map(m => m.name.toLowerCase())
      .filter(name => allergyTokens.some(token => name.includes(token) || token.includes(name)));
    if (flagged.length > 0) {
      throw Object.assign(
        new ValidationError(`Allergy contraindication: ${flagged.join(", ")} overlaps with patient allergy record`),
        { code: "ALLERGY_CONTRAINDICATION", status: 422 },
      );
    }
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
    await auditBreakGlass(req, "BREAK_GLASS_ACCESS", "prescription", id, { patientId: prescription.patientId, via: "get" });
  }

  await logRead(req, "prescription", id);
  return decryptPrescription(prescription);
}

export async function sendPrescriptionToPharmacy(req: AuthRequest, id: number) {
  // Verify the prescription exists in this clinic and is not voided.
  const [rx] = await db.select({ id: prescriptionsTable.id })
    .from(prescriptionsTable)
    .where(and(eq(prescriptionsTable.id, id), eq(prescriptionsTable.clinicId, req.user!.clinicId), isNull(prescriptionsTable.deletedAt)));
  if (!rx) throw new NotFoundError("prescription", id);

  // Fan out to every active pharmacist in the clinic.
  const pharmacists = await db.select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.clinicId, req.user!.clinicId), eq(usersTable.role, "pharmacist"), eq(usersTable.isActive, true)));

  if (pharmacists.length > 0) {
    await db.insert(notificationsTable).values(
      pharmacists.map((p) => ({
        clinicId: req.user!.clinicId,
        userId: p.id,
        title: "New prescription to fill",
        message: `Prescription #${id} was sent to the pharmacy.`,
        type: "general" as const,
      })),
    );
    // SSE carries IDs only â€” no PHI (clients fetch the record via the API).
    for (const p of pharmacists) emitToUser(p.id, "notification", { prescriptionId: id });
  }

  await logAudit(req, "SEND_TO_PHARMACY", "prescription", id, { pharmacistsNotified: pharmacists.length } as object);
  return { sent: true, pharmacistsNotified: pharmacists.length };
}

export async function dispensePrescription(req: AuthRequest, id: number) {
  const conditions: any[] = [
    eq(prescriptionsTable.id, id),
    eq(prescriptionsTable.clinicId, req.user!.clinicId),
    isNull(prescriptionsTable.deletedAt),
  ];
  const [before] = await db.select().from(prescriptionsTable).where(and(...conditions));
  if (!before) throw new NotFoundError("prescription", id);
  if (before.dispensedAt) throw new ValidationError("Prescription already dispensed");

  const [after] = await db
    .update(prescriptionsTable)
    .set({ dispensedAt: new Date(), dispensedById: req.user!.userId, updatedAt: new Date() })
    .where(and(...conditions))
    .returning();

  await logAudit(req, "DISPENSE", "prescription", id, null, auditSnapshot(before), auditSnapshot(after));
  return decryptPrescription(after);
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
