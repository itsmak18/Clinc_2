import { Router } from "express";
import { db } from "@workspace/db";
import { medicalRecordsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(requireAuth);
router.use("/medical-records", requireRole("super_admin", "admin", "doctor", "nurse"));

router.get("/medical-records", async (req, res) => {
  const { patientId, doctorId } = req.query;
  const rows = await db.select({
    id: medicalRecordsTable.id,
    patientId: medicalRecordsTable.patientId,
    doctorId: medicalRecordsTable.doctorId,
    appointmentId: medicalRecordsTable.appointmentId,
    chiefComplaint: medicalRecordsTable.chiefComplaint,
    diagnosis: medicalRecordsTable.diagnosis,
    treatment: medicalRecordsTable.treatment,
    notes: medicalRecordsTable.notes,
    vitals: medicalRecordsTable.vitals,
    createdAt: medicalRecordsTable.createdAt,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName },
    doctor: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(medicalRecordsTable)
    .leftJoin(patientsTable, eq(medicalRecordsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(medicalRecordsTable.doctorId, usersTable.id))
    .where(isNull(medicalRecordsTable.deletedAt))
    .orderBy(desc(medicalRecordsTable.createdAt));

  let results = rows;
  if (patientId) results = results.filter(r => r.patientId === parseInt(patientId as string));
  if (doctorId) results = results.filter(r => r.doctorId === parseInt(doctorId as string));
  res.json(results);
});

router.post("/medical-records", async (req: AuthRequest, res) => {
  const { patientId, doctorId, appointmentId, chiefComplaint, diagnosis, treatment, notes, vitals } = req.body;
  if (!patientId || !doctorId || !chiefComplaint || !diagnosis || !treatment) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const [record] = await db.insert(medicalRecordsTable).values({
    patientId, doctorId, appointmentId, chiefComplaint, diagnosis, treatment, notes, vitals,
  }).returning();
  await logAudit(req, "CREATE", "medical_record", record.id);
  res.status(201).json(record);
});

router.get("/medical-records/:recordId", async (req, res) => {
  const [record] = await db.select().from(medicalRecordsTable).where(eq(medicalRecordsTable.id, parseInt(req.params.recordId)));
  if (!record) { res.status(404).json({ error: "Not found" }); return; }
  res.json(record);
});

router.patch("/medical-records/:recordId", async (req: AuthRequest, res) => {
  const { chiefComplaint, diagnosis, treatment, notes, vitals } = req.body;
  const [record] = await db.update(medicalRecordsTable)
    .set({ chiefComplaint, diagnosis, treatment, notes, vitals, updatedAt: new Date() })
    .where(eq(medicalRecordsTable.id, parseInt(req.params.recordId)))
    .returning();
  await logAudit(req, "UPDATE", "medical_record", record.id);
  res.json(record);
});

export default router;
