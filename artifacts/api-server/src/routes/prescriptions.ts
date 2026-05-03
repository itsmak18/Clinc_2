import { Router } from "express";
import { db } from "@workspace/db";
import { prescriptionsTable, patientsTable, usersTable } from "@workspace/db";
import { eq, isNull, desc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(requireAuth);

// Nurses and lab staff can read prescriptions (to administer / cross-reference)
// Only doctors/admins may create them
router.get("/prescriptions", requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff"), async (req, res) => {
  const { patientId } = req.query;
  const rows = await db.select({
    id: prescriptionsTable.id,
    patientId: prescriptionsTable.patientId,
    doctorId: prescriptionsTable.doctorId,
    recordId: prescriptionsTable.recordId,
    medications: prescriptionsTable.medications,
    notes: prescriptionsTable.notes,
    createdAt: prescriptionsTable.createdAt,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName },
    doctor: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(prescriptionsTable)
    .leftJoin(patientsTable, eq(prescriptionsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(prescriptionsTable.doctorId, usersTable.id))
    .where(isNull(prescriptionsTable.deletedAt))
    .orderBy(desc(prescriptionsTable.createdAt));

  let results = rows;
  if (patientId) results = results.filter(r => r.patientId === parseInt(patientId as string));
  res.json(results);
});

router.post("/prescriptions", requireRole("super_admin", "admin", "doctor"), async (req: AuthRequest, res) => {
  const { patientId, doctorId, recordId, medications, notes } = req.body;
  if (!patientId || !doctorId || !medications?.length) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const [prescription] = await db.insert(prescriptionsTable).values({
    patientId, doctorId, recordId, medications, notes,
  }).returning();
  await logAudit(req, "CREATE", "prescription", prescription.id);
  res.status(201).json(prescription);
});

router.get("/prescriptions/:prescriptionId", requireRole("super_admin", "admin", "doctor", "nurse", "lab_staff"), async (req, res) => {
  const [prescription] = await db.select().from(prescriptionsTable).where(eq(prescriptionsTable.id, parseInt(req.params.prescriptionId as string)));
  if (!prescription) { res.status(404).json({ error: "Not found" }); return; }
  res.json(prescription);
});

export default router;
