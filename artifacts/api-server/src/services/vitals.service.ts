// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI writes/reads (tx).
// The lone raw db read (patient existence) carries an explicit eq(clinicId) filter.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import { vitalsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, and, isNull, desc, inArray } from "drizzle-orm";
import { logAudit, logRead } from "../lib/audit";
import { vitalsSchema } from "../lib/jsonb-schemas";
import { encryptJsonNullable, decryptJsonNullable } from "../lib/field-encryption";
import { isDoctorScoped, getDoctorListScope } from "../lib/scope";
import { autoAdvanceVisit } from "./appointments.service";
import { NotFoundError, ValidationError } from "./errors";
import type { AuthRequest } from "../middlewares/auth";

function decryptVitals<T extends { vitals: unknown }>(row: T): T {
  return { ...row, vitals: decryptJsonNullable(row.vitals as any) };
}

/**
 * Record vital signs as a first-class clinical record â€” NOT a medical record.
 * Deliberately has NO treatment-consent gate and NO placeholder diagnosis: a
 * nurse can take vitals at triage without the doctor's consultation paperwork.
 * The `vitals` JSONB is field-encrypted (PHI), shape-guarded by `vitalsSchema`.
 */
export async function createVitals(
  req: AuthRequest,
  data: { patientId: unknown; appointmentId?: unknown; notes?: string; vitals?: unknown },
) {
  const pid = Number(data.patientId);
  if (!pid) throw new ValidationError("patientId is required");

  // Strict JSONB guard (split BP + physiological ranges). Never insert unvalidated.
  const parsedVitals = vitalsSchema.safeParse(data.vitals);
  if (!parsedVitals.success) throw new ValidationError("Invalid vitals");

  const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable)
    .where(and(eq(patientsTable.id, pid), eq(patientsTable.clinicId, req.user!.clinicId), isNull(patientsTable.deletedAt)));
  if (!patient) throw new NotFoundError("patient", String(pid));

  const appointmentId = data.appointmentId != null ? Number(data.appointmentId) : null;

  const row = await runInTenantContext(req.user!, async (tx) => {
    const [created] = await tx.insert(vitalsTable).values({
      clinicId: req.user!.clinicId,
      patientId: pid,
      appointmentId,
      recordedById: req.user!.userId,
      vitals: encryptJsonNullable(parsedVitals.data ?? null),
      notes: data.notes,
    }).returning();
    return created;
  });

  await logAudit(req, "CREATE", "vitals", row.id);

  // Recording vitals advances the visit checked_in â†’ in_triage â†’ ready_for_doctor
  // (Phase 2 auto-advance; best-effort + idempotent). This is the trigger that
  // used to live on createMedicalRecord's rapid-vitals hack.
  await autoAdvanceVisit(req, { patientId: pid, appointmentId, actions: ["triage", "ready"] });

  return decryptVitals(row);
}

export async function listVitals(
  req: AuthRequest,
  params: { patientId?: string; appointmentId?: string },
) {
  const conditions: any[] = [eq(vitalsTable.clinicId, req.user!.clinicId), isNull(vitalsTable.deletedAt)];

  let breakGlassPatientIds: number[] = [];
  if (isDoctorScoped(req.user?.role)) {
    const scope = await getDoctorListScope(req, "vitals");
    breakGlassPatientIds = scope.breakGlassPatientIds;
    if (scope.allowed.length === 0) return [];
    conditions.push(inArray(vitalsTable.patientId, scope.allowed));
  }

  if (params.patientId) {
    const pid = parseInt(params.patientId);
    if (!isNaN(pid)) conditions.push(eq(vitalsTable.patientId, pid));
  }
  if (params.appointmentId) {
    const aid = parseInt(params.appointmentId);
    if (!isNaN(aid)) conditions.push(eq(vitalsTable.appointmentId, aid));
  }

  const rows = await runInTenantContext(req.user!, async (tx) =>
    tx.select({
      id: vitalsTable.id,
      patientId: vitalsTable.patientId,
      appointmentId: vitalsTable.appointmentId,
      recordedById: vitalsTable.recordedById,
      vitals: vitalsTable.vitals,
      notes: vitalsTable.notes,
      createdAt: vitalsTable.createdAt,
      recordedBy: { id: usersTable.id, fullName: usersTable.fullName },
    }).from(vitalsTable)
      .leftJoin(usersTable, eq(vitalsTable.recordedById, usersTable.id))
      .where(and(...conditions))
      .orderBy(desc(vitalsTable.createdAt))
      .limit(100),
    { breakGlassPatientIds },
  );

  await logAudit(req, "READ_LIST", "vitals", undefined, { count: rows.length });
  return rows.map(decryptVitals);
}
