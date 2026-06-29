// dbUnsafe: this service uses runInTenantContext for RLS-enforced PHI queries (tx). The
// remaining raw db calls have explicit eq(clinicId) filters (belt-and-braces). Using
// dbUnsafe acknowledges the intentional bypass for those specific call sites.
import { dbUnsafe as db, runInTenantContext } from "@workspace/db";
import {
  appointmentsTable, patientsTable, usersTable, notificationsTable,
  medicalRecordsTable, prescriptionsTable, xrayRecordsTable, labTestsTable, invoicesTable,
} from "@workspace/db";
import { eq, and, gte, lte, sql, desc, lt, inArray, notInArray, isNull } from "drizzle-orm";
import { logAudit, auditSnapshot } from "../../lib/audit";
import { emitToUser, emitToClinic } from "../../lib/sse";
import { logger } from "../../lib/logger";
import { isAutoAdvanceFlowEnabled } from "../../lib/auth-constants";
import { isDoctorScoped, getDoctorPatientScope, invalidateDoctorScope, recordDoctorPatientLink } from "../../lib/scope";
import { todayBoundary, getClinicTimezone } from "../../lib/dateUtils";
import { validateTransition, type AppointmentStatus, type AppointmentAction } from "../../lib/appointment-state-machine";
import { checkDoctorAvailability } from "../../lib/schedule-validator";
import { NotFoundError, ValidationError, ConflictError, ForbiddenError } from "../../services/errors";
import type { AuthRequest } from "../../middlewares/auth";

/**
 * Map a failed state-machine transition to a domain error so asyncHandler emits
 * the intended status (409 invalid-state / 403 role). A plain Error carrying a
 * `.status` prop is NOT recognized by asyncHandler and surfaces as a 500.
 */
function transitionError(result: { status: 409 | 403; error: string }): Error {
  return result.status === 403 ? new ForbiddenError(result.error) : new ConflictError(result.error);
}

export async function listAppointments(
  req: AuthRequest,
  params: {
    status?: string;
    date?: string;
    doctorId?: string;
    patientId?: string;
    limit?: string;
    cursor?: string;
  },
) {
  const lim = Math.min(parseInt(params.limit ?? "50") || 50, 100);
  const conditions: any[] = [eq(appointmentsTable.clinicId, req.user!.clinicId)];

  if (isDoctorScoped(req.user?.role)) {
    const scopedPatientIds = await getDoctorPatientScope(req.user!.userId);
    if (scopedPatientIds.length === 0) return { data: [], nextCursor: null };
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
    const did = parseInt(params.doctorId);
    if (!isNaN(did)) conditions.push(eq(appointmentsTable.doctorId, did));
  }
  if (params.patientId) {
    const pid = parseInt(params.patientId);
    if (!isNaN(pid)) conditions.push(eq(appointmentsTable.patientId, pid));
  }
  if (params.cursor) {
    const cursorId = parseInt(params.cursor);
    if (!isNaN(cursorId)) conditions.push(lt(appointmentsTable.id, cursorId));
  }

  const rows = await runInTenantContext(req.user!, async (tx) =>
    tx.select({
      id: appointmentsTable.id,
      patientId: appointmentsTable.patientId,
      doctorId: appointmentsTable.doctorId,
      scheduledAt: appointmentsTable.scheduledAt,
      reason: appointmentsTable.reason,
      status: appointmentsTable.status,
      bookingSource: appointmentsTable.bookingSource,
      triagePriority: appointmentsTable.triagePriority,
      notes: appointmentsTable.notes,
      cancellationReason: appointmentsTable.cancellationReason,
      checkedInAt: appointmentsTable.checkedInAt,
      triageStartedAt: appointmentsTable.triageStartedAt,
      consultationStartedAt: appointmentsTable.consultationStartedAt,
      createdAt: appointmentsTable.createdAt,
      patient: { id: patientsTable.id, fullName: patientsTable.fullName, mrn: patientsTable.mrn, dateOfBirth: patientsTable.dateOfBirth, phone: patientsTable.phone, insuranceProvider: patientsTable.insuranceProvider },
      doctor: { id: usersTable.id, fullName: usersTable.fullName, specialty: usersTable.specialty },
    }).from(appointmentsTable)
      .leftJoin(patientsTable, eq(appointmentsTable.patientId, patientsTable.id))
      .leftJoin(usersTable, eq(appointmentsTable.doctorId, usersTable.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(appointmentsTable.id))
      .limit(lim),
  );

  const nextCursor = rows.length === lim ? rows[rows.length - 1].id : null;
  return { data: rows, nextCursor };
}

export async function createAppointment(
  req: AuthRequest,
  data: { patientId: number; doctorId: number; scheduledAt: string; reason: string; notes?: string; bookingSource?: string },
) {
  // Required fields (patientId, doctorId, scheduledAt, reason) are validated at the
  // route by validate(CreateAppointmentBody). We still re-check the date is parseable.
  const scheduledDate = new Date(data.scheduledAt);
  if (isNaN(scheduledDate.getTime())) throw new ValidationError("Invalid scheduledAt date");

  const clinicId = req.user!.clinicId;
  const [patient] = await db.select({ id: patientsTable.id }).from(patientsTable)
    .where(and(eq(patientsTable.id, data.patientId), eq(patientsTable.clinicId, clinicId), isNull(patientsTable.deletedAt)));
  if (!patient) throw new NotFoundError("patient", String(data.patientId));

  const [doctor] = await db.select({ id: usersTable.id }).from(usersTable)
    .where(and(eq(usersTable.id, data.doctorId), eq(usersTable.clinicId, clinicId), eq(usersTable.role, "doctor")));
  if (!doctor) throw new NotFoundError("doctor", String(data.doctorId));

  const availability = await checkDoctorAvailability(req.user!, data.doctorId, scheduledDate);
  if (!availability.available) throw new ConflictError(availability.reason ?? "Doctor not available");

  let appt: typeof appointmentsTable.$inferSelect;
  try {
    [appt] = await db.insert(appointmentsTable).values({
      clinicId,
      patientId: data.patientId,
      doctorId: data.doctorId,
      scheduledAt: scheduledDate,
      reason: data.reason,
      notes: data.notes,
      bookingSource: (data.bookingSource as any) ?? "walk_in",
    }).returning();
  } catch (err: any) {
    if (err?.code === "23505") throw new ConflictError("Doctor already has an appointment at this time");
    throw err;
  }
  await logAudit(req, "CREATE", "appointment", appt.id);
  await recordDoctorPatientLink(appt.clinicId, appt.doctorId, appt.patientId, appt.scheduledAt);
  await invalidateDoctorScope(data.doctorId);
  return appt;
}

export async function getAppointmentFlow(req: AuthRequest) {
  const { start, end } = todayBoundary(getClinicTimezone(req));
  const rows = await runInTenantContext(req.user!, async (tx) => {
    return tx.select({
      status: appointmentsTable.status,
      checkedInAt: appointmentsTable.checkedInAt,
      triageStartedAt: appointmentsTable.triageStartedAt,
      consultationStartedAt: appointmentsTable.consultationStartedAt,
      updatedAt: appointmentsTable.updatedAt,
    }).from(appointmentsTable)
      .where(and(
        eq(appointmentsTable.clinicId, req.user!.clinicId),
        gte(appointmentsTable.scheduledAt, start),
        lte(appointmentsTable.scheduledAt, end)
      ));
  });

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

export async function getTodayAppointments(req: AuthRequest) {
  const { start, end } = todayBoundary(getClinicTimezone(req));
  // A doctor's Today queue is THEIR daily worklist — only appointments where they
  // are the assigned doctor. nurse / front_desk run the whole clinic queue and
  // legitimately see everyone's, so the scope filter is doctor-only.
  const conditions: any[] = [
    eq(appointmentsTable.clinicId, req.user!.clinicId),
    gte(appointmentsTable.scheduledAt, start),
    lte(appointmentsTable.scheduledAt, end),
  ];
  if (isDoctorScoped(req.user?.role)) {
    conditions.push(eq(appointmentsTable.doctorId, req.user!.userId));
  }
  const appointments = await runInTenantContext(req.user!, async (tx) => {
    return tx.select({
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
      .where(and(...conditions))
      .orderBy(appointmentsTable.scheduledAt);
  });

  return {
    appointments,
    total:        appointments.length,
    checkedIn:    appointments.filter(a => a.status === "checked_in").length,
    completed:    appointments.filter(a => a.status === "completed").length,
    inTriage:     appointments.filter(a => a.status === "in_triage").length,
    readyForDoctor: appointments.filter(a => a.status === "ready_for_doctor").length,
  };
}

export async function getAppointment(req: AuthRequest, id: number) {
  // Phase 2.2 rollout: was previously unconditional `db.select()` with no
  // clinic filter â€” another forgotten-filter foot-gun the audit found.
  // Now scoped via runInTenantContext + explicit eq(clinicId).
  const appt = await runInTenantContext(req.user!, async (tx) => {
    const [row] = await tx.select().from(appointmentsTable).where(and(
      eq(appointmentsTable.id, id),
      eq(appointmentsTable.clinicId, req.user!.clinicId),
    ));
    return row;
  });
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

  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(appointmentsTable.id, id), eq(appointmentsTable.clinicId, req.user!.clinicId)];

    const [before] = await tx.select().from(appointmentsTable).where(and(...conditions));
    if (!before) throw new NotFoundError("appointment", id);

    const targetDoctorId    = update.doctorId    !== undefined ? update.doctorId    : before.doctorId;
    const targetScheduledAt = update.scheduledAt !== undefined ? update.scheduledAt : new Date(before.scheduledAt);

    if (update.doctorId !== undefined || update.scheduledAt !== undefined) {
      const availability = await checkDoctorAvailability(req.user!, targetDoctorId, targetScheduledAt, tx);
      if (!availability.available) throw new ConflictError(availability.reason ?? "Doctor not available");
    }

    let appt: typeof appointmentsTable.$inferSelect;
    try {
      [appt] = await tx.update(appointmentsTable).set(update).where(and(...conditions)).returning();
    } catch (err: any) {
      if (err?.code === "23505") throw new ConflictError("Doctor already has an appointment at this time");
      throw err;
    }
    await logAudit(req, "UPDATE", "appointment", appt.id, null, auditSnapshot(before), auditSnapshot(appt));
    await recordDoctorPatientLink(appt.clinicId, appt.doctorId, appt.patientId, appt.scheduledAt ?? new Date());
    await invalidateDoctorScope(appt.doctorId);
    return appt;
  });
}

export async function cancelAppointment(req: AuthRequest, id: number, cancellationReason?: string) {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(appointmentsTable.id, id), eq(appointmentsTable.clinicId, req.user!.clinicId)];

    // Load first so a missing / cross-tenant id is a clean 404 — the previous
    // blind UPDATE returned no row and then threw a raw TypeError on appt.id.
    const [existing] = await tx.select().from(appointmentsTable).where(and(...conditions));
    if (!existing) throw new NotFoundError("appointment", id);

    // Route cancellation through the state machine so terminal states
    // (completed / cancelled / no_show) and role rules are enforced uniformly.
    // This DELETE path previously bypassed validateTransition entirely, letting
    // a completed visit be flipped back to cancelled.
    const transition = validateTransition("cancel", existing.status as AppointmentStatus, req.user!.role);
    if (!transition.ok) throw transitionError(transition);

    // Compare-and-swap on the validated status (see transitionAppointment).
    const [appt] = await tx.update(appointmentsTable)
      .set({ status: "cancelled", cancellationReason: cancellationReason || null, updatedAt: new Date() })
      .where(and(...conditions, eq(appointmentsTable.status, existing.status)))
      .returning();
    if (!appt) {
      throw new ConflictError("Appointment state changed concurrently. Refresh and retry.");
    }

    await logAudit(req, "CANCEL", "appointment", appt.id, { cancellationReason }, auditSnapshot(existing), auditSnapshot(appt));
    await invalidateDoctorScope(appt.doctorId);
    emitToClinic(req.user!.clinicId, "appointment.transition", { appointmentId: appt.id, status: appt.status });
  });
}

export async function transitionAppointment(
  req: AuthRequest,
  id: number,
  action: string,
  extraFields: Record<string, any> = {},
) {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(appointmentsTable.id, id), eq(appointmentsTable.clinicId, req.user!.clinicId)];

    const [existing] = await tx.select().from(appointmentsTable).where(and(...conditions));
    if (!existing) throw new NotFoundError("appointment", id);

    const transition = validateTransition(action as any, existing.status as AppointmentStatus, req.user!.role);
    if (!transition.ok) throw transitionError(transition);

    // Compare-and-swap: the UPDATE only matches while status is still what we
    // validated against. If a concurrent request advanced (or changed) the row
    // between our SELECT and this UPDATE, 0 rows return → 409 (prevents the
    // lost-update / conflicting-transition race; no version column needed).
    const [appt] = await tx.update(appointmentsTable)
      .set({ status: transition.toStatus, updatedAt: new Date(), ...extraFields })
      .where(and(...conditions, eq(appointmentsTable.status, existing.status)))
      .returning();
    if (!appt) {
      throw new ConflictError(
        `Appointment state changed concurrently (expected '${existing.status}'). Refresh and retry.`,
      );
    }

    // Cross-role real-time: nudge every board in the clinic to refresh. IDs +
    // status only (no PHI). Covers triage/ready/consult/diagnostics/reconsult/
    // payment/complete AND the Phase 2 auto-advances (which route through here).
    emitToClinic(req.user!.clinicId, "appointment.transition", { appointmentId: appt.id, status: appt.status });

    return { appt, existing };
  });
}

/**
 * Find the patient's single in-flight (non-terminal) visit in this clinic.
 * Returns the appointment id, or `null` when there are 0 or >1 candidates — we
 * never guess which visit to advance. Backs the auto-advance triggers for the
 * source rows that carry no `appointmentId` (ultrasound, invoices, rapid vitals).
 */
export async function resolveActiveVisit(req: AuthRequest, patientId: number): Promise<number | null> {
  return runInTenantContext(req.user!, async (tx) => {
    const rows = await tx.select({ id: appointmentsTable.id })
      .from(appointmentsTable)
      .where(and(
        eq(appointmentsTable.clinicId, req.user!.clinicId),
        eq(appointmentsTable.patientId, patientId),
        notInArray(appointmentsTable.status, ["completed", "cancelled", "no_show"]),
      ));
    return rows.length === 1 ? rows[0].id : null;
  });
}

/**
 * Best-effort patient-flow projection: advance a visit through one or more
 * state-machine actions as a side effect of a clinical write (vitals saved,
 * study ordered, invoice created), so the "extra" states cost zero manual clicks.
 *
 *  - flag-gated (`AUTO_ADVANCE_FLOW`); off → no-op.
 *  - idempotent: an action whose `from` no longer matches (already advanced) is
 *    skipped, never surfaced as a 409.
 *  - NON-FATAL: it never throws. A status nudge that fails (concurrent change,
 *    role gate, DB hiccup, vanished row) must not break the clinical write — the
 *    manual transition endpoints stay the source of truth.
 *  - safe under ambiguity: with no single active visit, it does nothing.
 *
 * Routes through `transitionAppointment`, so the CAS + audit guarantees hold and
 * the `getAppointmentFlow` wait-time timestamps are preserved.
 */
export async function autoAdvanceVisit(
  req: AuthRequest,
  opts: { patientId: number; appointmentId?: number | null; actions: AppointmentAction[] },
): Promise<void> {
  if (!isAutoAdvanceFlowEnabled()) return;
  try {
    const apptId = opts.appointmentId ?? await resolveActiveVisit(req, opts.patientId);
    if (!apptId) return;
    for (const action of opts.actions) {
      try {
        // Preserve the wait-time timestamps getAppointmentFlow keys off of.
        const extra =
          action === "triage" ? { triageStartedAt: new Date() } :
          action === "consult" ? { consultationStartedAt: new Date() } : {};
        await transitionAppointment(req, apptId, action, extra);
      } catch (err) {
        // Invalid-from (already advanced), lost CAS race, role gate, or a vanished
        // row are all expected for a best-effort nudge — try the next action
        // rather than aborting the chain.
        if (err instanceof ConflictError || err instanceof ForbiddenError || err instanceof NotFoundError) continue;
        throw err;
      }
    }
  } catch (err) {
    logger.warn({ err, patientId: opts.patientId, actions: opts.actions }, "auto-advance flow nudge failed (non-fatal)");
  }
}

export async function checkinAppointment(req: AuthRequest, id: number) {
  return runInTenantContext(req.user!, async (tx) => {
    const conditions: any[] = [eq(appointmentsTable.id, id), eq(appointmentsTable.clinicId, req.user!.clinicId)];

    const [existing] = await tx.select().from(appointmentsTable).where(and(...conditions));
    if (!existing) throw new NotFoundError("appointment", id);
    if (existing.status !== "scheduled") {
      throw new ConflictError(`Cannot check in: appointment is already '${existing.status}'`);
    }

    // CAS on the validated status closes the TOCTOU gap between the check above
    // and this write (two staff clicking "check in" at once → one wins, one 409s).
    const [appt] = await tx.update(appointmentsTable)
      .set({ status: "checked_in", checkedInAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions, eq(appointmentsTable.status, "scheduled")))
      .returning();
    if (!appt) {
      throw new ConflictError("Cannot check in: appointment state changed concurrently. Refresh and retry.");
    }

    const notifData = {
      clinicId: req.user!.clinicId,
      userId: appt.doctorId,
      title: "Patient Arrived",
      message: `A patient has checked in for their appointment (ID: ${appt.id})`,
      type: "patient_arrived" as const,
    };
    const [notif] = await tx.insert(notificationsTable).values(notifData).returning();
    emitToUser(appt.doctorId, "notification", notif);

    await logAudit(req, "CHECK_IN", "appointment", appt.id);
    emitToClinic(req.user!.clinicId, "appointment.transition", { appointmentId: appt.id, status: appt.status });
    return appt;
  });
}

export async function readyAppointment(req: AuthRequest, id: number) {
  const { appt } = await transitionAppointment(req, id, "ready");

  return runInTenantContext(req.user!, async (tx) => {
    const notifData = {
      clinicId: req.user!.clinicId,
      userId: appt.doctorId,
      title: "Patient Ready",
      message: "Patient is ready for consultation (vitals recorded)",
      type: "patient_arrived" as const,
    };
    const [notif] = await tx.insert(notificationsTable).values(notifData).returning().catch(() => [null]);
    if (notif) emitToUser(appt.doctorId, "notification", notif);

    await logAudit(req, "TRIAGE_COMPLETE", "appointment", appt.id);
    return appt;
  });
}

export async function getDischarge(req: AuthRequest, id: number) {
  return runInTenantContext(req.user!, async (tx) => {
    const [appt] = await tx.select({
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
      .where(and(eq(appointmentsTable.id, id), eq(appointmentsTable.clinicId, req.user!.clinicId)));

    if (!appt) throw new NotFoundError("appointment", id);

    const [patient] = await tx.select().from(patientsTable).where(and(eq(patientsTable.id, appt.patientId), eq(patientsTable.clinicId, req.user!.clinicId)));
    if (!patient) throw new NotFoundError("patient");

    const [medicalRecord] = await tx.select().from(medicalRecordsTable)
      .where(and(eq(medicalRecordsTable.appointmentId, id), eq(medicalRecordsTable.clinicId, req.user!.clinicId)))
      .orderBy(desc(medicalRecordsTable.createdAt))
      .limit(1);

    const prescriptions = medicalRecord
      ? await tx.select().from(prescriptionsTable).where(and(eq(prescriptionsTable.recordId, medicalRecord.id), eq(prescriptionsTable.clinicId, req.user!.clinicId)))
      : [];

    const apptDay = new Date(appt.scheduledAt);
    const dayStart = new Date(apptDay.getFullYear(), apptDay.getMonth(), apptDay.getDate());
    const dayEnd   = new Date(apptDay.getFullYear(), apptDay.getMonth(), apptDay.getDate(), 23, 59, 59);

    const [labTests, xrays, invoice] = await Promise.all([
      tx.select().from(labTestsTable).where(and(
        eq(labTestsTable.patientId, appt.patientId),
        eq(labTestsTable.clinicId, req.user!.clinicId),
        sql`(${labTestsTable.appointmentId} = ${id} OR (${labTestsTable.appointmentId} IS NULL AND ${labTestsTable.createdAt} BETWEEN ${dayStart} AND ${dayEnd}))`,
      )),
      tx.select().from(xrayRecordsTable).where(and(
        eq(xrayRecordsTable.patientId, appt.patientId),
        eq(xrayRecordsTable.clinicId, req.user!.clinicId),
        sql`(${xrayRecordsTable.appointmentId} = ${id} OR (${xrayRecordsTable.appointmentId} IS NULL AND ${xrayRecordsTable.createdAt} BETWEEN ${dayStart} AND ${dayEnd}))`,
      )),
      tx.select().from(invoicesTable)
        .where(and(eq(invoicesTable.patientId, appt.patientId), eq(invoicesTable.clinicId, req.user!.clinicId)))
        .orderBy(desc(invoicesTable.createdAt))
        .limit(1),
    ]);

    return {
      appointment: appt, patient,
      medicalRecord: medicalRecord ?? null,
      prescriptions, labTests, xrays,
      invoice: invoice[0] ?? null,
    };
  });
}
