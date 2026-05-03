import { Router } from "express";
import { db } from "@workspace/db";
import { patientsTable, appointmentsTable, medicalRecordsTable, usersTable } from "@workspace/db";
import { ilike, or, isNull, eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router = Router();
router.use(requireAuth);

router.get("/search", async (req: AuthRequest, res) => {
  const q = (req.query.q as string ?? "").trim();
  if (q.length < 2) { res.json({ patients: [], appointments: [], records: [] }); return; }

  const like = `%${q}%`;

  const patients = await db
    .select({ id: patientsTable.id, fullName: patientsTable.fullName, fullNameAr: patientsTable.fullNameAr, mrn: patientsTable.mrn, phone: patientsTable.phone, dateOfBirth: patientsTable.dateOfBirth })
    .from(patientsTable)
    .where(or(ilike(patientsTable.fullName, like), ilike(patientsTable.mrn, like), ilike(patientsTable.phone, like)))
    .limit(5);

  const appointments = await db
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
    .limit(5);

  const records = await db
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
    .limit(5);

  res.json({ patients, appointments, records });
});

export default router;
