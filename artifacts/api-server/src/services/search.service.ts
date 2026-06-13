// All queries run inside runInTenantContext (RLS-enforced) with belt-and-braces
// eq(clinicId) filters. No raw dbUnsafe call sites in this service.
import { runInTenantContext } from "@workspace/db";
import { patientsTable, appointmentsTable, medicalRecordsTable } from "@workspace/db";
import { ilike, or, eq, and } from "drizzle-orm";
import { logRead } from "../lib/audit";
import type { AuthRequest } from "../middlewares/auth";

export async function globalSearch(req: AuthRequest, query: string) {
  if (query.length < 2) return { patients: [], appointments: [], records: [] };

  const like = `%${query}%`;

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
            or(ilike(appointmentsTable.reason, like), ilike(patientsTable.fullName, like), ilike(patientsTable.mrn, like))
          )
        )
        .limit(5),

      tx
        .select({
          id: medicalRecordsTable.id,
          diagnosis: medicalRecordsTable.diagnosis,
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
            or(ilike(medicalRecordsTable.diagnosis, like), ilike(medicalRecordsTable.chiefComplaint, like), ilike(patientsTable.fullName, like))
          )
        )
        .limit(5),
    ]);

    void logRead(req, "SEARCH", undefined);
    return { patients, appointments, records };
  });
}
