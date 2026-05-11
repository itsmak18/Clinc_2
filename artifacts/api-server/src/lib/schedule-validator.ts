import { db } from "@workspace/db";
import { doctorSchedulesTable, scheduleOverridesTable, appointmentsTable } from "@workspace/db";
import { eq, and, gte, lte, notInArray } from "drizzle-orm";

export async function checkDoctorAvailability(doctorId: number, scheduledDate: Date): Promise<{ available: boolean; reason?: string }> {
  const dateStr = `${scheduledDate.getFullYear()}-${String(scheduledDate.getMonth() + 1).padStart(2, "0")}-${String(scheduledDate.getDate()).padStart(2, "0")}`;
  const timeStr = `${String(scheduledDate.getHours()).padStart(2, "0")}:${String(scheduledDate.getMinutes()).padStart(2, "0")}`;

  const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
  const dayName = DOW[scheduledDate.getDay()];

  const [override] = await db
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
    const [template] = await db
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

  // Check for exact double-booking
  const conflict = await db.select({ id: appointmentsTable.id })
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
