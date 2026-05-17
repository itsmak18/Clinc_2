import { db } from "@workspace/db";
import {
  appointmentsTable, patientsTable, usersTable, notificationsTable,
  medicalRecordsTable, prescriptionsTable, xrayRecordsTable, labTestsTable, invoicesTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, desc, inArray } from "drizzle-orm";
import { logAudit } from "../lib/audit";
import { emitToUser } from "../lib/sse";
import { isDoctorScoped, getDoctorPatientScope } from "../lib/scope";
import { todayBoundary } from "../lib/dateUtils";
import { validateTransition, type AppointmentStatus } from "../lib/appointment-state-machine";
import { checkDoctorAvailability } from "../lib/schedule-validator";
import { NotFoundError, ValidationError, ConflictError } from "./errors";
import { safeParseInt } from "../lib/validators";
import type { AuthRequest } from "../middlewares/auth";

export async function listAppointments(
  req: AuthRequest,
  params: {
    status?: string;
    date?: string;
    doctorId?: string;
    patientId?: string;
    limit?: string;
    offset?: string;
  },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 200);
  const off = parseInt(params.offset ?? "0") || 0;
  const conditions: any[] = [];

  if (isDoctorScoped(req.user?.role)) {
    const scopedPatientIds = await getDoctorPatientScope(req.user!.userId);
    if (scopedPatientIds.length === 0) return [];
    conditions.push(inArray(appointmentsTable.patientId, scopedPatientIds));
  }

  if (params.status) conditions.push(eq(appointmentsTable.status, params.status as any));
  if (params.date) {
    const d = new Date(params.date);
    if (isNaN(d.getTime())) throw new ValidationError("Invalid date format");
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const dayEnd   = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    conditions.push(gte(appointmentsTable.scheduledAt, dayStart));
    conditions.push(lte(appointmentsTable.scheduledAt, dayEnd));
  }
  if (params.doctorId) {
    const did = safeParseInt(params.doctorId);
    if (!did) throw new ValidationError("Invalid doctorId");
    conditions.push(eq(appointmentsTable.doctorId, did));
  }
  if (params.patientId) {
    const pid = safeParseInt(params.patientId);
    if (!pid) throw new ValidationError("Invalid patientId");
    conditions.push(eq(appointmentsTable.patientId, pid));
  }

  return db.select({
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
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(appointmentsTable.scheduledAt))
    .limit(lim)
    .offset(off);
}

export async function createAppointment(
  req: AuthRequest,
  data: { patientId: number; doctorId: number; scheduledAt: string; reason: string; notes?: string; bookingSource?: string },
) {
  if (!data.patientId || !data.doctorId || !data.scheduledAt || !data.reason) {
    throw new ValidationError("Missing required fields");
  }
  const scheduledDate = new Date(data.scheduledAt);
  if (isNaN(scheduledDate.getTime())) throw new ValidationError("Invalid scheduledAt date");

  const availability = await checkDoctorAvailability(data.doctorId, scheduledDate);
  if (!availability.available) throw new ConflictError(availability.reason ?? "Doctor not available");

  const [appt] = await db.insert(appointmentsTable).values({
    patientId: data.patientId,
    doctorId: data.doctorId,
    scheduledAt: scheduledDate,
    reason: data.reason,
    notes: data.notes,
    bookingSource: (data.bookingSource as any) ?? "walk_in",
  }).returning();
  await logAudit(req, "CREATE", "appointment", appt.id);
  return appt;
}

export async function getAppointmentFlow() {
  const { start, end } = todayBoundary();
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

  const triageWaits = rows
    .filter(r => r.checkedInAt && r.triageStartedAt)
    .map(r => (r.triageStartedAt!.getTime() - r.checkedInAt!.getTime()) / 60000);
  const avgArrivalToTriage = triageWaits.length
    ? Math.round(triageWaits.reduce((a, b) => a + b, 0) / triageWaits.length) : null;

  const consultWaits = rows
    .filter(r => r.triageStartedAt && r.consultationStartedAt)
    .map(r => (r.consultationStartedAt!.getTime() - r.triageStartedAt!.getTime()) / 60000);
  const avgTriageToConsultation = consultWaits.length
    ? Math.round(consultWaits.reduce((a, b) => a + b, 0) / consultWaits.length) : null;

  const consultDurations = rows
    .filter(r => r.consultationStartedAt && r.status === "completed")
    .map(r => (r.updatedAt.getTime() - r.consultationStartedAt!.getTime()) / 60000);
  const avgConsultationToPayment = consultDurations.length
    ? Math.round(consultDurations.reduce((a, b) => a + b, 0) / consultDurations.length) : null;

  const activeStatuses = ["checked_in", "in_triage", "ready_for_doctor", "in_consultation", "awaiting_diagnostics", "pending_payment"];
  const activePatients = activeStatuses.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

  return {
    stageCounts: counts,
    avgWaitMins: { arrivalToTriage: avgArrivalToTriage, triageToConsultation: avgTriageToConsultation, consultationToPayment: avgConsultationToPayment },
    totalToday: rows.length,
    activePatients,
    refreshedAt: new Date().toISOString(),
  };
}

export async function getTodayAppointments() {
  const { start, end } = todayBoundary();
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

  return {
    appointments,
    total:        appointments.length,
    checkedIn:    appointments.filter(a => a.status === "checked_in").length,
    completed:    appointments.filter(a => a.status === "completed").length,
    inTriage:     appointments.filter(a => a.status === "in_triage").length,
    readyForDoctor: appointments.filter(a => a.status === "ready_for_doctor").length,
  };
}

export async function getAppointment(id: number) {
  const [appt] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!appt) throw new NotFoundError("appointment", id);
  return appt;
}

export async function patchAppointment(req: AuthRequest, id: number, body: Record<string, any>) {
  const role = req.user!.role;
  const allowed: Record<string, string[]> = {
    super_admin: ["status", "doctorId", "scheduledAt", "reason", "notes", "cancellationReason"],
    admin:       ["status", "doctorId", "scheduledAt", "reason", "notes", "cancellationReason"],
    front_desk:  ["doctorId", "scheduledAt", "reason", "cancellationReason"],
    nurse:       ["notes"],
    doctor:      ["notes"],
  };

  if (body.status && body.status !== "cancelled") {
    throw new ValidationError("Use the dedicated state machine endpoints to advance appointment status");
  }

  const permittedFields = allowed[role] ?? [];
  const update: Record<string, any> = { updatedAt: new Date() };
  for (const field of permittedFields) {
    if (body[field] !== undefined) {
      update[field] = field === "scheduledAt" ? new Date(body[field]) : body[field];
    }
  }
  if (Object.keys(update).length === 1) throw new ValidationError("No permitted fields provided for your role");

  const [before] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!before) throw new NotFoundError("appointment", id);

  const targetDoctorId    = update.doctorId    !== undefined ? update.doctorId    : before.doctorId;
  const targetScheduledAt = update.scheduledAt !== undefined ? update.scheduledAt : new Date(before.scheduledAt);

  if (update.doctorId !== undefined || update.scheduledAt !== undefined) {
    const availability = await checkDoctorAvailability(targetDoctorId, targetScheduledAt);
    if (!availability.available) throw new ConflictError(availability.reason ?? "Doctor not available");
  }

  const [appt] = await db.update(appointmentsTable).set(update).where(eq(appointmentsTable.id, id)).returning();
  await logAudit(req, "UPDATE", "appointment", appt.id, { before, after: appt });
  return appt;
}

export async function cancelAppointment(req: AuthRequest, id: number, cancellationReason?: string) {
  const [appt] = await db.update(appointmentsTable)
    .set({ status: "cancelled", cancellationReason: cancellationReason || null, updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();
  await logAudit(req, "CANCEL", "appointment", appt.id, { cancellationReason });
}

export async function transitionAppointment(
  req: AuthRequest,
  id: number,
  action: string,
  extraFields: Record<string, any> = {},
) {
  const [existing] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!existing) throw new NotFoundError("appointment", id);

  const transition = validateTransition(action as any, existing.status as AppointmentStatus, req.user!.role);
  if (!transition.ok) {
    throw Object.assign(new Error(transition.error ?? "Transition not allowed"), {
      status: transition.status,
      detail: transition.detail,
    });
  }

  const [appt] = await db.update(appointmentsTable)
    .set({ status: transition.toStatus, updatedAt: new Date(), ...extraFields })
    .where(eq(appointmentsTable.id, id))
    .returning();

  return { appt, existing };
}

export async function checkinAppointment(req: AuthRequest, id: number) {
  const [existing] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!existing) throw new NotFoundError("appointment", id);
  if (existing.status !== "scheduled") {
    throw new ConflictError(`Cannot check in: appointment is already '${existing.status}'`);
  }

  const [appt] = await db.update(appointmentsTable)
    .set({ status: "checked_in", checkedInAt: new Date(), updatedAt: new Date() })
    .where(eq(appointmentsTable.id, id))
    .returning();

  const notifData = {
    userId: appt.doctorId,
    title: "Patient Arrived",
    message: `A patient has checked in for their appointment (ID: ${appt.id})`,
    type: "patient_arrived" as const,
  };
  const [notif] = await db.insert(notificationsTable).values(notifData).returning();
  emitToUser(appt.doctorId, "notification", notif);

  await logAudit(req, "CHECK_IN", "appointment", appt.id);
  return appt;
}

export async function readyAppointment(req: AuthRequest, id: number) {
  const { appt } = await transitionAppointment(req, id, "ready");

  const notifData = {
    userId: appt.doctorId,
    title: "Patient Ready",
    message: "Patient is ready for consultation (vitals recorded)",
    type: "patient_arrived" as const,
  };
  const [notif] = await db.insert(notificationsTable).values(notifData).returning().catch(() => [null]);
  if (notif) emitToUser(appt.doctorId, "notification", notif);

  await logAudit(req, "TRIAGE_COMPLETE", "appointment", appt.id);
  return appt;
}

export async function getDischarge(id: number) {
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

  if (!appt) throw new NotFoundError("appointment", id);

  const [patient] = await db.select().from(patientsTable).where(eq(patientsTable.id, appt.patientId));
  if (!patient) throw new NotFoundError("patient");

  const [medicalRecord] = await db.select().from(medicalRecordsTable)
    .where(eq(medicalRecordsTable.appointmentId, id))
    .orderBy(desc(medicalRecordsTable.createdAt))
    .limit(1);

  const prescriptions = medicalRecord
    ? await db.select().from(prescriptionsTable).where(eq(prescriptionsTable.recordId, medicalRecord.id))
    : [];

  const apptDay = new Date(appt.scheduledAt);
  const dayStart = new Date(apptDay.getFullYear(), apptDay.getMonth(), apptDay.getDate());
  const dayEnd   = new Date(apptDay.getFullYear(), apptDay.getMonth(), apptDay.getDate(), 23, 59, 59);

  const [labTests, xrays, invoice] = await Promise.all([
    db.select().from(labTestsTable).where(and(
      eq(labTestsTable.patientId, appt.patientId),
      sql`(${labTestsTable.appointmentId} = ${id} OR (${labTestsTable.appointmentId} IS NULL AND ${labTestsTable.createdAt} BETWEEN ${dayStart} AND ${dayEnd}))`,
    )),
    db.select().from(xrayRecordsTable).where(and(
      eq(xrayRecordsTable.patientId, appt.patientId),
      sql`(${xrayRecordsTable.appointmentId} = ${id} OR (${xrayRecordsTable.appointmentId} IS NULL AND ${xrayRecordsTable.createdAt} BETWEEN ${dayStart} AND ${dayEnd}))`,
    )),
    db.select().from(invoicesTable)
      .where(eq(invoicesTable.patientId, appt.patientId))
      .orderBy(desc(invoicesTable.createdAt))
      .limit(1),
  ]);

  return {
    appointment: appt, patient,
    medicalRecord: medicalRecord ?? null,
    prescriptions, labTests, xrays,
    invoice: invoice[0] ?? null,
  };
}
