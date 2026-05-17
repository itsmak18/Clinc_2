import { db } from "@workspace/db";
import { patientsTable, appointmentsTable, medicalRecordsTable } from "@workspace/db";
import { ilike, or, eq } from "drizzle-orm";
import { logRead } from "../lib/audit";
import type { AuthRequest } from "../middlewares/auth";

export async function globalSearch(req: AuthRequest, query: string) {
  if (query.length < 2) return { patients: [], appointments: [], records: [] };

  const like = `%${query}%`;

  const [patients, appointments, records] = await Promise.all([
    db
      .select({
        id: patientsTable.id,
        fullName: patientsTable.fullName,
        fullNameAr: patientsTable.fullNameAr,
        mrn: patientsTable.mrn,
        phone: patientsTable.phone,
        dateOfBirth: patientsTable.dateOfBirth,
      })
      .from(patientsTable)
      .where(or(ilike(patientsTable.fullName, like), ilike(patientsTable.mrn, like), ilike(patientsTable.phone, like)))
      .limit(5),

    db
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
      .where(or(ilike(appointmentsTable.reason, like), ilike(patientsTable.fullName, like), ilike(patientsTable.mrn, like)))
      .limit(5),

    db
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
      .where(or(ilike(medicalRecordsTable.diagnosis, like), ilike(medicalRecordsTable.chiefComplaint, like), ilike(patientsTable.fullName, like)))
      .limit(5),
  ]);

  void logRead(req, "SEARCH", undefined);
  return { patients, appointments, records };
}
