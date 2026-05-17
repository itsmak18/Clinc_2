import { db } from "@workspace/db";
import {
  doctorSchedulesTable,
  scheduleOverridesTable,
  usersTable,
  appointmentsTable,
} from "@workspace/db";
import { eq, and, gte, lte, notInArray, sql } from "drizzle-orm";
import { logAudit, logRead, logDenied } from "../lib/audit";
import { isDoctorScoped } from "../lib/scope";
import { NotFoundError, ForbiddenError, ValidationError } from "./errors";
import { generateSlots, DOW, todayDateStr } from "./schedule.slots";
import type { AuthRequest } from "../middlewares/auth";

// ── Doctors list with weekly templates ──────────────────────────────────────

export async function listDoctorsWithTemplates(req: AuthRequest) {
  const doctors = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      fullNameAr: usersTable.fullNameAr,
      specialty: usersTable.specialty,
      department: usersTable.department,
      isOnShift: usersTable.isOnShift,
    })
    .from(usersTable)
    .where(and(eq(usersTable.role, "doctor"), eq(usersTable.isActive, true)));

  const filteredDoctors = isDoctorScoped(req.user?.role)
    ? doctors.filter((d) => d.id === req.user!.userId)
    : doctors;

  const doctorIds = filteredDoctors.map((d) => d.id);
  const templates =
    doctorIds.length > 0
      ? await db
          .select()
          .from(doctorSchedulesTable)
          .where(
            doctorIds.length === 1
              ? eq(doctorSchedulesTable.doctorId, doctorIds[0])
              : sql`${doctorSchedulesTable.doctorId} = ANY(${doctorIds})`,
          )
      : [];

  return filteredDoctors.map((doc) => ({
    ...doc,
    weeklyTemplate: templates.filter((t) => t.doctorId === doc.id),
  }));
}

// ── Single doctor: template + overrides ─────────────────────────────────────

export async function getDoctorSchedule(req: AuthRequest, doctorId: number) {
  if (isDoctorScoped(req.user?.role) && req.user!.userId !== doctorId) {
    await logDenied(req, "doctor_schedule", doctorId, "out_of_scope");
    throw new ForbiddenError("Forbidden");
  }

  const [doctor] = await db
    .select({
      id: usersTable.id,
      fullName: usersTable.fullName,
      fullNameAr: usersTable.fullNameAr,
      specialty: usersTable.specialty,
      department: usersTable.department,
      isOnShift: usersTable.isOnShift,
    })
    .from(usersTable)
    .where(and(eq(usersTable.id, doctorId), eq(usersTable.role, "doctor")));

  if (!doctor) throw new NotFoundError("Doctor not found");

  const [weeklyTemplate, overrides] = await Promise.all([
    db.select().from(doctorSchedulesTable).where(eq(doctorSchedulesTable.doctorId, doctorId)),
    db.select().from(scheduleOverridesTable).where(eq(scheduleOverridesTable.doctorId, doctorId)),
  ]);

  void logRead(req, "doctor_schedule", doctorId);
  return { doctor, weeklyTemplate, overrides };
}

// ── Availability for a single date ──────────────────────────────────────────

export async function getDoctorAvailability(req: AuthRequest, doctorId: number, dateStr: string) {
  if (isDoctorScoped(req.user?.role) && req.user!.userId !== doctorId) {
    await logDenied(req, "doctor_schedule", doctorId, "out_of_scope");
    throw new ForbiddenError("Forbidden");
  }

  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new ValidationError("date query param required (YYYY-MM-DD)");
  }

  const targetDate = new Date(dateStr + "T00:00:00");
  if (isNaN(targetDate.getTime())) throw new ValidationError("Invalid date");

  const dayName = DOW[targetDate.getDay()];

  const [override] = await db
    .select()
    .from(scheduleOverridesTable)
    .where(
      and(
        eq(scheduleOverridesTable.doctorId, doctorId),
        eq(scheduleOverridesTable.overrideDate, dateStr),
      ),
    );

  if (override?.isBlocked) {
    return { available: false, date: dateStr, reason: override.reason ?? "Doctor unavailable", slots: [] };
  }

  let effectiveStart: string | null = null;
  let effectiveEnd: string | null = null;
  let slotMinutes = 30;

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
          eq(doctorSchedulesTable.status, "active"),
        ),
      );

    if (!template) {
      return { available: false, date: dateStr, reason: "No schedule for this day", slots: [] };
    }

    effectiveStart = template.startTime;
    effectiveEnd = template.endTime;
    slotMinutes = template.slotMinutes;
  }

  const slots = generateSlots(effectiveStart, effectiveEnd, slotMinutes);

  const dayStart = new Date(dateStr + "T00:00:00");
  const dayEnd = new Date(dateStr + "T23:59:59.999");
  const booked = await db
    .select({ scheduledAt: appointmentsTable.scheduledAt })
    .from(appointmentsTable)
    .where(
      and(
        eq(appointmentsTable.doctorId, doctorId),
        gte(appointmentsTable.scheduledAt, dayStart),
        lte(appointmentsTable.scheduledAt, dayEnd),
        notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
      ),
    );

  const bookedTimes = new Set(
    booked.map((b) => {
      const d = new Date(b.scheduledAt);
      return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }),
  );

  const slotAvailability = slots.map((time) => ({
    time,
    available: !bookedTimes.has(time),
    datetime: `${dateStr}T${time}:00`,
  }));

  return { available: true, date: dateStr, slots: slotAvailability };
}

// ── 7-day week view ──────────────────────────────────────────────────────────

export async function getWeekView(req: AuthRequest, doctorId: number, weekStartStr: string) {
  if (isDoctorScoped(req.user?.role) && req.user!.userId !== doctorId) {
    await logDenied(req, "doctor_schedule", doctorId, "out_of_scope");
    throw new ForbiddenError("Forbidden");
  }

  if (!weekStartStr || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartStr)) {
    throw new ValidationError("weekStart query param required (YYYY-MM-DD)");
  }

  const weekStart = new Date(weekStartStr + "T00:00:00");
  if (isNaN(weekStart.getTime())) throw new ValidationError("Invalid weekStart");

  const todayStr = todayDateStr();

  const [templates, overrides] = await Promise.all([
    db.select().from(doctorSchedulesTable).where(eq(doctorSchedulesTable.doctorId, doctorId)),
    db.select().from(scheduleOverridesTable).where(eq(scheduleOverridesTable.doctorId, doctorId)),
  ]);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const bookedRows = await db
    .select({ scheduledAt: appointmentsTable.scheduledAt })
    .from(appointmentsTable)
    .where(
      and(
        eq(appointmentsTable.doctorId, doctorId),
        gte(appointmentsTable.scheduledAt, weekStart),
        lte(appointmentsTable.scheduledAt, weekEnd),
        notInArray(appointmentsTable.status, ["cancelled", "no_show"]),
      ),
    );

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const dayName = DOW[d.getDay()];

    const override = overrides.find((o) => o.overrideDate === dateStr);
    const template = templates.find((t) => t.dayOfWeek === dayName && t.status === "active");

    let isWorking = false;
    let startTime: string | null = null;
    let endTime: string | null = null;
    let slotMinutes = 30;
    let overrideReason: string | null = null;

    if (override?.isBlocked) {
      isWorking = false;
      overrideReason = override.reason ?? "Blocked";
    } else if (override?.startTime && override?.endTime) {
      isWorking = true;
      startTime = override.startTime;
      endTime = override.endTime;
      overrideReason = override.reason ?? null;
    } else if (template) {
      isWorking = true;
      startTime = template.startTime;
      endTime = template.endTime;
      slotMinutes = template.slotMinutes;
    }

    const totalSlots =
      isWorking && startTime && endTime ? generateSlots(startTime, endTime, slotMinutes).length : 0;

    const dayStart = new Date(dateStr + "T00:00:00");
    const dayEnd = new Date(dateStr + "T23:59:59.999");
    const bookedCount = bookedRows.filter((b) => {
      const ba = new Date(b.scheduledAt);
      return ba >= dayStart && ba <= dayEnd;
    }).length;

    return {
      date: dateStr,
      dayName,
      isWorking,
      startTime,
      endTime,
      slotMinutes,
      totalSlots,
      bookedCount,
      availableSlots: Math.max(0, totalSlots - bookedCount),
      overrideReason,
      isToday: dateStr === todayStr,
    };
  });

  return { doctorId, weekStart: weekStartStr, days };
}

// ── Upsert weekly block ──────────────────────────────────────────────────────

export async function upsertWeeklyBlock(
  req: AuthRequest,
  doctorId: number,
  body: {
    dayOfWeek?: string;
    startTime?: string;
    endTime?: string;
    slotMinutes?: number;
    maxPatients?: number;
    notes?: string;
    status?: string;
  },
) {
  const { dayOfWeek, startTime, endTime, slotMinutes, maxPatients, notes, status } = body;
  if (!dayOfWeek || !startTime || !endTime) {
    throw new ValidationError("dayOfWeek, startTime, endTime required");
  }

  const [row] = await db
    .insert(doctorSchedulesTable)
    .values({
      doctorId,
      dayOfWeek: dayOfWeek as any,
      startTime,
      endTime,
      slotMinutes: slotMinutes ?? 30,
      maxPatients: maxPatients ?? 16,
      notes: notes ?? null,
      status: (status ?? "active") as any,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [doctorSchedulesTable.doctorId, doctorSchedulesTable.dayOfWeek],
      set: {
        startTime,
        endTime,
        slotMinutes: slotMinutes ?? 30,
        maxPatients: maxPatients ?? 16,
        notes: notes ?? null,
        status: (status ?? "active") as any,
        updatedAt: new Date(),
      },
    })
    .returning();

  void logAudit(req, "UPSERT", "doctor_schedule", row.id);
  return row;
}

// ── Toggle weekly block status ───────────────────────────────────────────────

export async function setWeeklyBlockStatus(
  req: AuthRequest,
  doctorId: number,
  day: string,
  status: string,
) {
  if (status !== "active" && status !== "inactive") {
    throw new ValidationError("status must be 'active' or 'inactive'");
  }

  const [row] = await db
    .update(doctorSchedulesTable)
    .set({ status: status as any, updatedAt: new Date() })
    .where(
      and(
        eq(doctorSchedulesTable.doctorId, doctorId),
        eq(doctorSchedulesTable.dayOfWeek, day as any),
      ),
    )
    .returning();

  if (!row) throw new NotFoundError("Schedule block not found");
  void logAudit(req, "UPDATE", "doctor_schedule", row.id);
  return row;
}

// ── Delete weekly block ──────────────────────────────────────────────────────

export async function deleteWeeklyBlock(req: AuthRequest, doctorId: number, day: string) {
  const [row] = await db
    .delete(doctorSchedulesTable)
    .where(
      and(
        eq(doctorSchedulesTable.doctorId, doctorId),
        eq(doctorSchedulesTable.dayOfWeek, day as any),
      ),
    )
    .returning();

  if (!row) throw new NotFoundError("Schedule block not found");
  void logAudit(req, "DELETE", "doctor_schedule", row.id);
}

// ── Upsert schedule override ─────────────────────────────────────────────────

export async function upsertOverride(
  req: AuthRequest,
  doctorId: number,
  body: {
    overrideDate?: string;
    isBlocked?: boolean;
    startTime?: string;
    endTime?: string;
    reason?: string;
  },
) {
  const { overrideDate, isBlocked, startTime, endTime, reason } = body;
  if (!overrideDate || !/^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) {
    throw new ValidationError("overrideDate required (YYYY-MM-DD)");
  }

  const [row] = await db
    .insert(scheduleOverridesTable)
    .values({
      doctorId,
      overrideDate,
      isBlocked: isBlocked ?? false,
      startTime: isBlocked ? null : (startTime ?? null),
      endTime: isBlocked ? null : (endTime ?? null),
      reason: reason ?? null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [scheduleOverridesTable.doctorId, scheduleOverridesTable.overrideDate],
      set: {
        isBlocked: isBlocked ?? false,
        startTime: isBlocked ? null : (startTime ?? null),
        endTime: isBlocked ? null : (endTime ?? null),
        reason: reason ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  void logAudit(req, "UPSERT", "schedule_override", row.id);
  return row;
}

// ── Delete schedule override ─────────────────────────────────────────────────

export async function deleteOverride(req: AuthRequest, doctorId: number, date: string) {
  const [row] = await db
    .delete(scheduleOverridesTable)
    .where(
      and(
        eq(scheduleOverridesTable.doctorId, doctorId),
        eq(scheduleOverridesTable.overrideDate, date),
      ),
    )
    .returning();

  if (!row) throw new NotFoundError("Override not found");
  void logAudit(req, "DELETE", "schedule_override", row.id);
}
