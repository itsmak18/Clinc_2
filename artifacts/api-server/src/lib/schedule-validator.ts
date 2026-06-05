import { runInTenantContext } from "@workspace/db";
import { doctorSchedulesTable, scheduleOverridesTable, appointmentsTable } from "@workspace/db";
import { eq, and, notInArray } from "drizzle-orm";

/**
 * Tenant identity required to open the RLS-scoped transaction.
 *
 * The schedule tables (`doctor_schedules`, `schedule_overrides`) carry
 * `FORCE ROW LEVEL SECURITY` with a non-dormant `tenant_isolation` policy
 * (migration 0022): `clinic_id = current_setting('app.clinic_id')::int`. Outside
 * a tenant context that GUC is unset, so the policy matches zero rows and every
 * read here would come back empty — making `checkDoctorAvailability` report
 * "No schedule for this day" for every booking (audit finding F-P1-1).
 *
 * Running the reads inside `runInTenantContext` sets `app.clinic_id`, so RLS
 * resolves to the caller's clinic and also supplies the clinic filter the query
 * bodies intentionally omit (doctorId is clinic-unique, RLS enforces the rest).
 */
export interface AvailabilityActor {
  userId: number;
  clinicId: number;
  role: string;
}

/** The transactional client `runInTenantContext` hands to its callback. */
type TenantTx = Parameters<Parameters<typeof runInTenantContext>[1]>[0];

/**
 * Core availability evaluation. Runs every read through the supplied
 * tenant-scoped `tx` so RLS (migration 0022) resolves to the caller's clinic.
 */
async function evaluateAvailability(
  tx: TenantTx,
  doctorId: number,
  scheduledDate: Date,
): Promise<{ available: boolean; reason?: string }> {
  const dateStr = `${scheduledDate.getFullYear()}-${String(scheduledDate.getMonth() + 1).padStart(2, "0")}-${String(scheduledDate.getDate()).padStart(2, "0")}`;
  const timeStr = `${String(scheduledDate.getHours()).padStart(2, "0")}:${String(scheduledDate.getMinutes()).padStart(2, "0")}`;

  const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  const dayName = DOW[scheduledDate.getDay()];

  const [override] = await tx
    .select()
    .from(scheduleOverridesTable)
    .where(and(eq(scheduleOverridesTable.doctorId, doctorId), eq(scheduleOverridesTable.overrideDate, dateStr)));

  if (override?.isBlocked) {
    return { available: false, reason: override.reason ?? "Doctor unavailable" };
  }

  let effectiveStart: string | null = null;
  let effectiveEnd: string | null = null;

  if (override && override.startTime && override.endTime) {
    effectiveStart = override.startTime;
    effectiveEnd = override.endTime;
  } else {
    const [template] = await tx
      .select()
      .from(doctorSchedulesTable)
      .where(
        and(
          eq(doctorSchedulesTable.doctorId, doctorId),
          eq(doctorSchedulesTable.dayOfWeek, dayName),
          eq(doctorSchedulesTable.status, "active")
        )
      );

    if (!template) {
      return { available: false, reason: "No schedule for this day" };
    }

    effectiveStart = template.startTime;
    effectiveEnd = template.endTime;
  }

  if (!effectiveStart || !effectiveEnd) {
    return { available: false, reason: "Invalid schedule configuration" };
  }

  if (timeStr < effectiveStart || timeStr >= effectiveEnd) {
    return { available: false, reason: `Time slot ${timeStr} is outside working hours (${effectiveStart} - ${effectiveEnd})` };
  }

  // Check for exact double-booking — the unique index appt_no_double_book_idx
  // enforces this atomically at the DB level; this check gives a friendly message.
  const conflict = await tx.select({ id: appointmentsTable.id })
    .from(appointmentsTable)
    .where(
      and(
        eq(appointmentsTable.doctorId, doctorId),
        eq(appointmentsTable.scheduledAt, scheduledDate),
        notInArray(appointmentsTable.status, ["cancelled", "no_show"])
      )
    )
    .limit(1);

  if (conflict.length > 0) {
    return { available: false, reason: "Doctor already has an appointment at this exact time" };
  }

  return { available: true };
}

/**
 * Verify a doctor is available for `scheduledDate`.
 *
 * @param actor       tenant identity used to open the RLS transaction.
 * @param doctorId    doctor being booked (clinic-unique; RLS scopes by clinic).
 * @param scheduledDate requested slot.
 * @param existingTx  optional — when the caller already runs inside a
 *                    `runInTenantContext` transaction (e.g. updateAppointment),
 *                    pass its `tx` to reuse that connection instead of opening a
 *                    nested transaction on a second pooled connection.
 */
export async function checkDoctorAvailability(
  actor: AvailabilityActor,
  doctorId: number,
  scheduledDate: Date,
  existingTx?: TenantTx,
): Promise<{ available: boolean; reason?: string }> {
  if (existingTx) {
    return evaluateAvailability(existingTx, doctorId, scheduledDate);
  }
  return runInTenantContext(actor, (tx) => evaluateAvailability(tx, doctorId, scheduledDate));
}
