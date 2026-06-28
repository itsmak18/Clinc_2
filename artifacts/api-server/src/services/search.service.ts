// All queries run inside runInTenantContext (RLS-enforced) with belt-and-braces
// eq(clinicId) filters. No raw dbUnsafe call sites in this service.
import { runInTenantContext } from "@workspace/db";
import { patientsTable, appointmentsTable, medicalRecordsTable } from "@workspace/db";
import { ilike, or, eq, and, inArray } from "drizzle-orm";
import { logRead } from "../lib/audit";
import { escapeLike } from "../lib/validators";
import { isDoctorScoped, getDoctorListScope } from "../lib/scope";
import type { AuthRequest } from "../middlewares/auth";

export async function globalSearch(req: AuthRequest, query: string) {
  if (query.length < 2) return { patients: [], appointments: [], records: [] };

  // Cap length so a multi-KB term can't drive three oversized parallel ILIKE
  // scans, and escape LIKE metacharacters (not SQLi — value is bound — but
  // prevents wildcard injection / pathological patterns).
  const like = `%${escapeLike(query.slice(0, 100))}%`;

  // Doctor scope: /search returns patient data, so a doctor must only see
  // patients/appointments/records within their assigned (+ active break-glass)
  // scope — same rule as listPatients. Non-doctor roles are clinic-scoped only.
  // getDoctorListScope is called ONCE (it audits BREAK_GLASS_ACCESS per call)
  // and the result is reused across all three branches.
  let allowed: number[] | null = null;
  let breakGlassPatientIds: number[] = [];
  if (isDoctorScoped(req.user?.role)) {
    const scope = await getDoctorListScope(req, "search");
    allowed = scope.allowed;
    breakGlassPatientIds = scope.breakGlassPatientIds;
    if (allowed.length === 0) {
      await logRead(req, "SEARCH", undefined);
      return { patients: [], appointments: [], records: [] };
    }
  }

  return runInTenantContext(req.user!, async (tx) => {
    const [patients, appointments, records] = await Promise.all([
      tx
        .select({
          id: patientsTable.id,
          fullName: patientsTable.fullName,
          fullNameAr: patientsTable.fullNameAr,
          mrn: patientsTable.mrn,
          phone: patientsTable.phone,
          dateOfBirth: patientsTable.dateOfBirth,
        })
        .from(patientsTable)
        .where(
          and(
            eq(patientsTable.clinicId, req.user!.clinicId),
            allowed ? inArray(patientsTable.id, allowed) : undefined,
            or(ilike(patientsTable.fullName, like), ilike(patientsTable.mrn, like), ilike(patientsTable.phone, like))
          )
        )
        .limit(5),

      tx
        .select({
          id: appointmentsTable.id,
          reason: appointmentsTable.reason,
          status: appointmentsTable.status,
          scheduledAt: appointmentsTable.scheduledAt,
          patientName: patientsTable.fullName,
          patientMrn: patientsTable.mrn,
        })
        .from(appointmentsTable)
        .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
        .where(
          and(
            eq(appointmentsTable.clinicId, req.user!.clinicId),
            allowed ? inArray(appointmentsTable.patientId, allowed) : undefined,
            or(ilike(appointmentsTable.reason, like), ilike(patientsTable.fullName, like), ilike(patientsTable.mrn, like))
          )
        )
        .limit(5),

      tx
        .select({
          // diagnosis is intentionally NOT selected — it is AES-GCM encrypted at
          // rest, so returning it would ship ciphertext to the client. The search
          // matches/displays the plaintext chiefComplaint instead.
          id: medicalRecordsTable.id,
          chiefComplaint: medicalRecordsTable.chiefComplaint,
          createdAt: medicalRecordsTable.createdAt,
          patientName: patientsTable.fullName,
          patientId: medicalRecordsTable.patientId,
        })
        .from(medicalRecordsTable)
        .leftJoin(patientsTable, eq(medicalRecordsTable.patientId, patientsTable.id))
        .where(
          and(
            eq(medicalRecordsTable.clinicId, req.user!.clinicId),
            // Redundant with the doctor_scope RLS (migration 0017) on
            // medical_records, but kept for defense-in-depth + consistency.
            allowed ? inArray(medicalRecordsTable.patientId, allowed) : undefined,
            // diagnosis is AES-GCM encrypted at rest — an ILIKE matches ciphertext,
            // never plaintext, so it is intentionally excluded. chiefComplaint is
            // not encrypted and remains searchable.
            or(ilike(medicalRecordsTable.chiefComplaint, like), ilike(patientsTable.fullName, like))
          )
        )
        .limit(5),
    ]);

    await logRead(req, "SEARCH", undefined);
    return { patients, appointments, records };
  }, { breakGlassPatientIds });
}
