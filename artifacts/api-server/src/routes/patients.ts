import { Router } from "express";
import { db } from "@workspace/db";
import {
  patientsTable, appointmentsTable, medicalRecordsTable, xrayRecordsTable,
  labTestsTable, invoicesTable, usersTable
} from "@workspace/db";
import { eq, isNull, ilike, or, sql, desc, sum } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(requireAuth);

function generateMRN(): string {
  const prefix = "MRN";
  const num = Date.now().toString().slice(-6);
  const suffix = Math.floor(Math.random() * 100).toString().padStart(2, "0");
  return `${prefix}${num}${suffix}`;
}

router.get("/patients", async (req: AuthRequest, res) => {
  const { search, limit = "50", offset = "0" } = req.query;
  let patients = await db.select().from(patientsTable).where(isNull(patientsTable.deletedAt))
    .limit(parseInt(limit as string)).offset(parseInt(offset as string));
  if (search) {
    const q = (search as string).toLowerCase();
    patients = patients.filter(p =>
      p.fullName.toLowerCase().includes(q) ||
      (p.fullNameAr?.toLowerCase().includes(q)) ||
      p.mrn.includes(q) ||
      p.phone.includes(q)
    );
  }
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(patientsTable).where(isNull(patientsTable.deletedAt));
  res.json({ patients, total: Number(count) });
});

router.post("/patients", requireRole("super_admin", "admin", "nurse", "front_desk"), async (req: AuthRequest, res) => {
  const { fullName, fullNameAr, dateOfBirth, gender, phone, address, bloodType, allergies, emergencyContact } = req.body;
  if (!fullName || !dateOfBirth || !gender || !phone) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const mrn = generateMRN();
  const [patient] = await db.insert(patientsTable).values({
    mrn, fullName, fullNameAr, dateOfBirth, gender, phone, address, bloodType, allergies, emergencyContact,
  }).returning();
  await logAudit(req, "CREATE", "patient", patient.id);
  res.status(201).json(patient);
});

router.get("/patients/:patientId", async (req, res) => {
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, parseInt(req.params.patientId)));
  if (!patient) { res.status(404).json({ error: "Not found" }); return; }
  res.json(patient);
});

router.patch("/patients/:patientId", requireRole("super_admin", "admin", "nurse", "front_desk"), async (req: AuthRequest, res) => {
  const { fullName, fullNameAr, phone, address, bloodType, allergies, emergencyContact, isActive } = req.body;
  const [patient] = await db.update(patientsTable)
    .set({ fullName, fullNameAr, phone, address, bloodType, allergies, emergencyContact, isActive, updatedAt: new Date() })
    .where(eq(patientsTable.id, parseInt(req.params.patientId)))
    .returning();
  await logAudit(req, "UPDATE", "patient", patient.id);
  res.json(patient);
});

router.delete("/patients/:patientId", requireRole("super_admin", "admin"), async (req: AuthRequest, res) => {
  await db.update(patientsTable).set({ deletedAt: new Date() }).where(eq(patientsTable.id, parseInt(req.params.patientId)));
  await logAudit(req, "DELETE", "patient", parseInt(req.params.patientId));
  res.json({ success: true });
});

router.get("/patients/:patientId/summary", async (req, res) => {
  const patientId = parseInt(req.params.patientId);
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, patientId));
  if (!patient) { res.status(404).json({ error: "Not found" }); return; }

  const recentAppointments = await db.select({
    id: appointmentsTable.id, reason: appointmentsTable.reason, status: appointmentsTable.status,
    scheduledAt: appointmentsTable.scheduledAt,
    doctor: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(appointmentsTable)
    .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
    .where(eq(appointmentsTable.patientId, patientId))
    .orderBy(desc(appointmentsTable.scheduledAt)).limit(5);

  const recentRecords = await db.select().from(medicalRecordsTable)
    .where(eq(medicalRecordsTable.patientId, patientId))
    .orderBy(desc(medicalRecordsTable.createdAt)).limit(5);

  const recentXrays = await db.select().from(xrayRecordsTable)
    .where(eq(xrayRecordsTable.patientId, patientId))
    .orderBy(desc(xrayRecordsTable.createdAt)).limit(5);

  const recentLabTests = await db.select().from(labTestsTable)
    .where(eq(labTestsTable.patientId, patientId))
    .orderBy(desc(labTestsTable.createdAt)).limit(5);

  const pendingInvoices = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.patientId, patientId));
  const outstandingBalance = pendingInvoices
    .filter(inv => inv.status === "pending")
    .reduce((s, inv) => s + parseFloat(String(inv.total)), 0);

  res.json({ patient, recentAppointments, recentRecords, recentXrays, recentLabTests, outstandingBalance });
});

export default router;
