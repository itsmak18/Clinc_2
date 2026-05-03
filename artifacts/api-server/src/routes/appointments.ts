import { Router } from "express";
import { db } from "@workspace/db";
import { appointmentsTable, patientsTable, usersTable, notificationsTable, medicalRecordsTable, prescriptionsTable, xrayRecordsTable, labTestsTable, invoicesTable } from "@workspace/db";
import { eq, and, gte, lte, sql, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit } from "../lib/audit";
import { emitToUser } from "../lib/sse";

const router = Router();
router.use(requireAuth);
router.use("/appointments", requireRole("super_admin", "admin", "doctor", "nurse", "front_desk"));

router.get("/appointments", async (req, res) => {
  const status = req.query.status as string | undefined;
  const date = req.query.date as string | undefined;
  const doctorId = req.query.doctorId as string | undefined;
  const patientId = req.query.patientId as string | undefined;
  const limit = (req.query.limit as string) ?? "50";
  const offset = (req.query.offset as string) ?? "0";

  const rows = await db.select({
    id: appointmentsTable.id,
    patientId: appointmentsTable.patientId,
    doctorId: appointmentsTable.doctorId,
    scheduledAt: appointmentsTable.scheduledAt,
    reason: appointmentsTable.reason,
    status: appointmentsTable.status,
    notes: appointmentsTable.notes,
    cancellationReason: appointmentsTable.cancellationReason,
    checkedInAt: appointmentsTable.checkedInAt,
    triageStartedAt: appointmentsTable.triageStartedAt,
    consultationStartedAt: appointmentsTable.consultationStartedAt,
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

router.get("/appointments/flow", async (_req, res) => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

  const rows = await db.select({
    status: appointmentsTable.status,
    checkedInAt: appointmentsTable.checkedInAt,
    triageStartedAt: appointmentsTable.triageStartedAt,
    consultationStartedAt: appointmentsTable.consultationStartedAt,
    updatedAt: appointmentsTable.updatedAt,
  }).from(appointmentsTable)
    .where(and(gte(appointmentsTable.scheduledAt, start), lte(appointmentsTable.scheduledAt, end)));

  const counts: Record<string, number> = {
    scheduled: 0, checked_in: 0, in_triage: 0, ready_for_doctor: 0,
    in_consultation: 0, awaiting_diagnostics: 0, pending_payment: 0,
    completed: 0, cancelled: 0,
  };
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

  // Avg wait: checkedInAt → triageStartedAt
  const triageWaits = rows
    .filter(r => r.checkedInAt && r.triageStartedAt)
    .map(r => (r.triageStartedAt!.getTime() - r.checkedInAt!.getTime()) / 60000);
  const avgArrivalToTriage = triageWaits.length
    ? Math.round(triageWaits.reduce((a, b) => a + b, 0) / triageWaits.length) : null;

  // Avg wait: triageStartedAt → consultationStartedAt
  const consultWaits = rows
    .filter(r => r.triageStartedAt && r.consultationStartedAt)
    .map(r => (r.consultationStartedAt!.getTime() - r.triageStartedAt!.getTime()) / 60000);
  const avgTriageToConsultation = consultWaits.length
    ? Math.round(consultWaits.reduce((a, b) => a + b, 0) / consultWaits.length) : null;

  // Avg consult duration (consultationStartedAt → updatedAt for completed)
  const consultDurations = rows
    .filter(r => r.consultationStartedAt && r.status === "completed")
    .map(r => (r.updatedAt.getTime() - r.consultationStartedAt!.getTime()) / 60000);
  const avgConsultationToPayment = consultDurations.length
    ? Math.round(consultDurations.reduce((a, b) => a + b, 0) / consultDurations.length) : null;

  const activeStatuses = ["checked_in", "in_triage", "ready_for_doctor", "in_consultation", "awaiting_diagnostics", "pending_payment"];
  const activePatients = activeStatuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

  res.json({
    stageCounts: counts,
    avgWaitMins: { arrivalToTriage: avgArrivalToTriage, triageToConsultation: avgTriageToConsultation, consultationToPayment: avgConsultationToPayment },
    totalToday: rows.length,
    activePatients,
    refreshedAt: new Date().toISOString(),
  });
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
    checkedInAt: appointmentsTable.checkedInAt,
    patient: { id: patientsTable.id, fullName: patientsTable.fullName, mrn: patientsTable.mrn, allergies: patientsTable.allergies },
    doctor: { id: usersTable.id, fullName: usersTable.fullName },
  }).from(appointmentsTable)
    .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
    .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
    .where(and(gte(appointmentsTable.scheduledAt, start), lte(appointmentsTable.scheduledAt, end)))
    .orderBy(appointmentsTable.scheduledAt);

  const total = appointments.length;
  const checkedIn = appointments.filter(a => a.status === "checked_in").length;
  const completed = appointments.filter(a => a.status === "completed").length;
  const inTriage = appointments.filter(a => a.status === "in_triage").length;
  const readyForDoctor = appointments.filter(a => a.status === "ready_for_doctor").length;

  res.json({ appointments, total, checkedIn, completed, inTriage, readyForDoctor });
});

router.get("/appointments/:appointmentId", async (req, res) => {
  const id = parseInt(req.params.appointmentId as string);
  const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!appt) { res.status(404).json({ error: "Not found" }); return; }
  res.json(appt);
});

router.patch("/appointments/:appointmentId", async (req: AuthRequest, res) => {
  const id = parseInt(req.params.appointmentId as string);
  const { status, notes, reason, cancellationReason, doctorId, scheduledAt } = req.body;
  const before = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  const [appt] = await db.update(appointmentsTable)
    .set({ status, notes, reason, cancellationReason, doctorId, scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined, updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();
  await logAudit(req, "UPDATE", "appointment", appt.id, { before: before[0], after: appt });
  res.json(appt);
});

router.delete("/appointments/:appointmentId", async (req: AuthRequest, res) => {
  const id = parseInt(req.params.appointmentId as string);
  const { cancellationReason } = req.body || {};
  const [appt] = await db.update(appointmentsTable)
    .set({ status: "cancelled", cancellationReason: cancellationReason || null, updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();
  await logAudit(req, "CANCEL", "appointment", appt.id, { cancellationReason });
  res.json({ success: true });
});

// Check-in (Front Desk → checked_in)
router.post("/appointments/:appointmentId/checkin", async (req: AuthRequest, res) => {
  const id = parseInt(req.params.appointmentId as string);
  const [appt] = await db.update(appointmentsTable)
    .set({ status: "checked_in", checkedInAt: new Date(), updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, appt.patientId));

  const notifData = {
    userId: appt.doctorId,
    title: "Patient Arrived",
    message: `${patient?.fullName || "Patient"} has checked in for their appointment`,
    type: "patient_arrived" as const,
  };
  const [notif] = await db.insert(notificationsTable).values(notifData).returning();
  emitToUser(appt.doctorId, "notification", notif);

  await logAudit(req, "CHECK_IN", "appointment", appt.id);
  res.json(appt);
});

// Triage (Nurse → in_triage)
router.post("/appointments/:appointmentId/triage", requireRole("super_admin", "admin", "nurse"), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.appointmentId as string);
  const [appt] = await db.update(appointmentsTable)
    .set({ status: "in_triage", triageStartedAt: new Date(), updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();
  await logAudit(req, "TRIAGE_START", "appointment", appt.id);
  res.json(appt);
});

// Ready for Doctor (Nurse → ready_for_doctor)
router.post("/appointments/:appointmentId/ready", requireRole("super_admin", "admin", "nurse"), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.appointmentId as string);
  const [appt] = await db.update(appointmentsTable)
    .set({ status: "ready_for_doctor", updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();

  const notifData = {
    userId: appt.doctorId,
    title: "Patient Ready",
    message: `Patient is ready for consultation (vitals recorded)`,
    type: "patient_arrived" as const,
  };
  const [notif] = await db.insert(notificationsTable).values(notifData).returning().catch(() => [null]);
  if (notif) emitToUser(appt.doctorId, "notification", notif);

  await logAudit(req, "TRIAGE_COMPLETE", "appointment", appt.id);
  res.json(appt);
});

// Start consultation (Doctor → in_consultation)
router.post("/appointments/:appointmentId/consult", requireRole("super_admin", "admin", "doctor"), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.appointmentId as string);
  const [appt] = await db.update(appointmentsTable)
    .set({ status: "in_consultation", consultationStartedAt: new Date(), updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();
  await logAudit(req, "CONSULTATION_START", "appointment", appt.id);
  res.json(appt);
});

// Awaiting Diagnostics (Doctor → awaiting_diagnostics)
router.post("/appointments/:appointmentId/diagnostics", requireRole("super_admin", "admin", "doctor"), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.appointmentId as string);
  const [appt] = await db.update(appointmentsTable)
    .set({ status: "awaiting_diagnostics", updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();
  await logAudit(req, "DIAGNOSTICS_REQUESTED", "appointment", appt.id);
  res.json(appt);
});

// Pending Payment (Doctor/Nurse → pending_payment)
router.post("/appointments/:appointmentId/payment", requireRole("super_admin", "admin", "doctor", "nurse", "front_desk"), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.appointmentId as string);
  const [appt] = await db.update(appointmentsTable)
    .set({ status: "pending_payment", updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();
  await logAudit(req, "PENDING_PAYMENT", "appointment", appt.id);
  res.json(appt);
});

// Complete (Front Desk/Admin → completed)
router.post("/appointments/:appointmentId/complete", requireRole("super_admin", "admin", "front_desk"), async (req: AuthRequest, res) => {
  const id = parseInt(req.params.appointmentId as string);
  const [appt] = await db.update(appointmentsTable)
    .set({ status: "completed", updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();
  await logAudit(req, "COMPLETE", "appointment", appt.id);
  res.json(appt);
});

// Discharge summary for a specific appointment visit
router.get("/appointments/:appointmentId/discharge", async (req, res) => {
  const id = parseInt(req.params.appointmentId as string);

  const [appt] = await db.select({
    id: appointmentsTable.id,
    patientId: appointmentsTable.patientId,
    doctorId: appointmentsTable.doctorId,
    scheduledAt: appointmentsTable.scheduledAt,
    reason: appointmentsTable.reason,
    status: appointmentsTable.status,
    notes: appointmentsTable.notes,
    checkedInAt: appointmentsTable.checkedInAt,
    triageStartedAt: appointmentsTable.triageStartedAt,
    consultationStartedAt: appointmentsTable.consultationStartedAt,
    createdAt: appointmentsTable.createdAt,
    doctor: { id: usersTable.id, fullName: usersTable.fullName, fullNameAr: usersTable.fullNameAr },
  }).from(appointmentsTable)
    .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
    .where(eq(appointmentsTable.id, id));

  if (!appt) { res.status(404).json({ error: "Appointment not found" }); return; }

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, appt.patientId));
  if (!patient) { res.status(404).json({ error: "Patient not found" }); return; }

  // Medical record for this appointment
  const [medicalRecord] = await db.select().from(medicalRecordsTable)
    .where(eq(medicalRecordsTable.appointmentId, id))
    .orderBy(desc(medicalRecordsTable.createdAt))
    .limit(1);

  // Prescriptions linked to this record
  const prescriptions = medicalRecord
    ? await db.select().from(prescriptionsTable).where(eq(prescriptionsTable.recordId, medicalRecord.id))
    : [];

  // Lab tests & X-rays for this patient created on the same day as the appointment
  const apptDay = new Date(appt.scheduledAt);
  const dayStart = new Date(apptDay.getFullYear(), apptDay.getMonth(), apptDay.getDate());
  const dayEnd = new Date(apptDay.getFullYear(), apptDay.getMonth(), apptDay.getDate(), 23, 59, 59);

  const labTests = await db.select().from(labTestsTable)
    .where(and(eq(labTestsTable.patientId, appt.patientId), gte(labTestsTable.createdAt, dayStart), lte(labTestsTable.createdAt, dayEnd)));

  const xrays = await db.select().from(xrayRecordsTable)
    .where(and(eq(xrayRecordsTable.patientId, appt.patientId), gte(xrayRecordsTable.createdAt, dayStart), lte(xrayRecordsTable.createdAt, dayEnd)));

  // Most recent invoice for patient
  const [invoice] = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.patientId, appt.patientId))
    .orderBy(desc(invoicesTable.createdAt))
    .limit(1);

  res.json({ appointment: appt, patient, medicalRecord: medicalRecord ?? null, prescriptions, labTests, xrays, invoice: invoice ?? null });
});

export default router;
