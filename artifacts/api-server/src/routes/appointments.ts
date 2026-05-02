import { Router } from "express";
import { db } from "@workspace/db";
import { appointmentsTable, patientsTable, usersTable, notificationsTable } from "@workspace/db";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";

const router = Router();
router.use(requireAuth);

router.get("/appointments", async (req, res) => {
  const { status, date, doctorId, patientId, limit = "50", offset = "0" } = req.query;

  const rows = await db.select({
    id: appointmentsTable.id,
    patientId: appointmentsTable.patientId,
    doctorId: appointmentsTable.doctorId,
    scheduledAt: appointmentsTable.scheduledAt,
    reason: appointmentsTable.reason,
    status: appointmentsTable.status,
    notes: appointmentsTable.notes,
    checkedInAt: appointmentsTable.checkedInAt,
    createdAt: appointmentsTable.createdAt,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName, mrn: patientsTable.mrn },
    doctor: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
    .orderBy(desc(appointmentsTable.scheduledAt))
    .limit(parseInt(limit as string))
    .offset(parseInt(offset as string));

  let results = rows;
  if (status) results = results.filter(r => r.status === status);
  if (date) {
    const d = new Date(date as string);
    const start = new Date(d.setHours(0, 0, 0, 0));
    const end = new Date(d.setHours(23, 59, 59, 999));
    results = results.filter(r => r.scheduledAt >= start && r.scheduledAt <= end);
  }
  if (doctorId) results = results.filter(r => r.doctorId === parseInt(doctorId as string));
  if (patientId) results = results.filter(r => r.patientId === parseInt(patientId as string));

  res.json(results);
});

router.post("/appointments", async (req: AuthRequest, res) => {
  const { patientId, doctorId, scheduledAt, reason, notes } = req.body;
  if (!patientId || !doctorId || !scheduledAt || !reason) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const [appt] = await db.insert(appointmentsTable).values({
    patientId, doctorId, scheduledAt: new Date(scheduledAt), reason, notes,
  }).returning();
  await logAudit(req, "CREATE", "appointment", appt.id);
  res.status(201).json(appt);
});

router.get("/appointments/today", async (_req, res) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const appointments = await db.select({
    id: appointmentsTable.id,
    patientId: appointmentsTable.patientId,
    doctorId: appointmentsTable.doctorId,
    scheduledAt: appointmentsTable.scheduledAt,
    reason: appointmentsTable.reason,
    status: appointmentsTable.status,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName },
    doctor: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
    .where(and(gte(appointmentsTable.scheduledAt, start), lte(appointmentsTable.scheduledAt, end)))
    .orderBy(appointmentsTable.scheduledAt);

  const total = appointments.length;
  const checkedIn = appointments.filter(a => a.status === "checked_in").length;
  const completed = appointments.filter(a => a.status === "completed").length;

  res.json({ appointments, total, checkedIn, completed });
});

router.get("/appointments/:appointmentId", async (req, res) => {
  const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, parseInt(req.params.appointmentId)));
  if (!appt) { res.status(404).json({ error: "Not found" }); return; }
  res.json(appt);
});

router.patch("/appointments/:appointmentId", async (req: AuthRequest, res) => {
  const { status, notes, reason } = req.body;
  const [appt] = await db.update(appointmentsTable)
    .set({ status, notes, reason, updatedAt: new Date() })
    .where(eq(appointmentsTable.id, parseInt(req.params.appointmentId)))
    .returning();
  await logAudit(req, "UPDATE", "appointment", appt.id);
  res.json(appt);
});

router.delete("/appointments/:appointmentId", async (req: AuthRequest, res) => {
  const [appt] = await db.update(appointmentsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(appointmentsTable.id, parseInt(req.params.appointmentId)))
    .returning();
  await logAudit(req, "CANCEL", "appointment", appt.id);
  res.json({ success: true });
});

router.post("/appointments/:appointmentId/checkin", async (req: AuthRequest, res) => {
  const [appt] = await db.update(appointmentsTable)
    .set({ status: "checked_in", checkedInAt: new Date(), updatedAt: new Date() })
    .where(eq(appointmentsTable.id, parseInt(req.params.appointmentId)))
    .returning();

  // Get patient info for notification
  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, appt.patientId));
  // Notify doctor
  await db.insert(notificationsTable).values({
    userId: appt.doctorId,
    title: "Patient Arrived",
    message: `${patient?.fullName || "Patient"} has checked in for their appointment`,
    type: "patient_arrived",
  });

  await logAudit(req, "CHECK_IN", "appointment", appt.id);
  res.json(appt);
});

export default router;
