import { Router } from "express";
import { db } from "@workspace/db";
import {
  doctorSchedulesTable,
  scheduleOverridesTable,
  usersTable,
  appointmentsTable,
} from "@workspace/db";
import { eq, and, gte, lte, notInArray, sql } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logAudit, logRead, logDenied } from "../lib/audit";
import { isDoctorScoped } from "../lib/scope";
import { safeParseInt } from "../lib/validators";

const router = Router();
router.use(requireAuth);

const READ_ROLES = ["super_admin", "admin", "front_desk", "nurse", "doctor"] as const;
const WRITE_ROLES = ["super_admin", "admin"] as const;

// Generate time slots between startTime and endTime at slotMinutes intervals.
// Returns strings like "08:00", "08:30", ...
function generateSlots(startTime: string, endTime: string, slotMinutes: number): string[] {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  const slots: string[] = [];
  for (let cur = start; cur + slotMinutes <= end; cur += slotMinutes) {
    const h = Math.floor(cur / 60);
    const m = cur % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return slots;
}

// ───────────────────────────────────────────────
// GET /schedule/doctors  — all doctors with weekly templates
// ───────────────────────────────────────────────
router.get(
  "/schedule/doctors",
  requireRole(...READ_ROLES),
  async (req: AuthRequest, res) => {
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
                : sql`${doctorSchedulesTable.doctorId} = ANY(${doctorIds})`
            )
        : [];

    const result = filteredDoctors.map((doc) => ({
      ...doc,
      weeklyTemplate: templates.filter((t) => t.doctorId === doc.id),
    }));

    res.json(result);
  }
);

// ───────────────────────────────────────────────
// GET /schedule/doctor/:id  — single doctor: template + overrides
// ───────────────────────────────────────────────
router.get(
  "/schedule/doctor/:id",
  requireRole(...READ_ROLES),
  async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }

    if (isDoctorScoped(req.user?.role) && req.user!.userId !== doctorId) {
      await logDenied(req, "doctor_schedule", doctorId, "out_of_scope");
      res.status(403).json({ error: "Forbidden" });
      return;
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

    if (!doctor) { res.status(404).json({ error: "Doctor not found" }); return; }

    const [weeklyTemplate, overrides] = await Promise.all([
      db.select().from(doctorSchedulesTable).where(eq(doctorSchedulesTable.doctorId, doctorId)),
      db.select().from(scheduleOverridesTable).where(eq(scheduleOverridesTable.doctorId, doctorId)),
    ]);

    await logRead(req, "doctor_schedule", doctorId);
    res.json({ doctor, weeklyTemplate, overrides });
  }
);

// ───────────────────────────────────────────────
// GET /schedule/availability/:id?date=YYYY-MM-DD
// ───────────────────────────────────────────────
router.get(
  "/schedule/availability/:id",
  requireRole(...READ_ROLES),
  async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }

    if (isDoctorScoped(req.user?.role) && req.user!.userId !== doctorId) {
      await logDenied(req, "doctor_schedule", doctorId, "out_of_scope");
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const dateStr = req.query.date as string | undefined;
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      res.status(400).json({ error: "date query param required (YYYY-MM-DD)" });
      return;
    }

    const targetDate = new Date(dateStr + "T00:00:00");
    if (isNaN(targetDate.getTime())) {
      res.status(400).json({ error: "Invalid date" });
      return;
    }

    // Day-of-week index: 0=Sunday…6=Saturday
    const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
    const dayName = DOW[targetDate.getDay()];

    // Check for override first
    const [override] = await db
      .select()
      .from(scheduleOverridesTable)
      .where(
        and(
          eq(scheduleOverridesTable.doctorId, doctorId),
          eq(scheduleOverridesTable.overrideDate, dateStr)
        )
      );

    if (override?.isBlocked) {
      res.json({ available: false, date: dateStr, reason: override.reason ?? "Doctor unavailable", slots: [] });
      return;
    }

    // Determine effective hours
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
            eq(doctorSchedulesTable.status, "active")
          )
        );

      if (!template) {
        res.json({ available: false, date: dateStr, reason: "No schedule for this day", slots: [] });
        return;
      }

      effectiveStart = template.startTime;
      effectiveEnd = template.endTime;
      slotMinutes = template.slotMinutes;
    }

    const slots = generateSlots(effectiveStart, effectiveEnd, slotMinutes);

    // Find booked appointments for this doctor on this date (non-terminal statuses)
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
          notInArray(appointmentsTable.status, ["cancelled", "no_show"])
        )
      );

    // Build a set of booked HH:MM strings
    const bookedTimes = new Set(
      booked.map((b) => {
        const d = new Date(b.scheduledAt);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      })
    );

    const slotAvailability = slots.map((time) => ({
      time,
      available: !bookedTimes.has(time),
      datetime: `${dateStr}T${time}:00`,
    }));

    res.json({ available: true, date: dateStr, slots: slotAvailability });
  }
);

// ───────────────────────────────────────────────
// GET /schedule/week?doctorId=N&weekStart=YYYY-MM-DD
// ───────────────────────────────────────────────
router.get(
  "/schedule/week",
  requireRole(...READ_ROLES),
  async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.query.doctorId as string);
    if (!doctorId) { res.status(400).json({ error: "doctorId required" }); return; }

    if (isDoctorScoped(req.user?.role) && req.user!.userId !== doctorId) {
      await logDenied(req, "doctor_schedule", doctorId, "out_of_scope");
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const weekStartStr = req.query.weekStart as string | undefined;
    if (!weekStartStr || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartStr)) {
      res.status(400).json({ error: "weekStart query param required (YYYY-MM-DD)" });
      return;
    }

    const weekStart = new Date(weekStartStr + "T00:00:00");
    if (isNaN(weekStart.getTime())) { res.status(400).json({ error: "Invalid weekStart" }); return; }

    const DOW = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

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
          notInArray(appointmentsTable.status, ["cancelled", "no_show"])
        )
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

      const totalSlots = isWorking && startTime && endTime
        ? generateSlots(startTime, endTime, slotMinutes).length
        : 0;

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

    res.json({ doctorId, weekStart: weekStartStr, days });
  }
);

// ───────────────────────────────────────────────
// POST /schedule/doctor/:id/weekly  — upsert a weekly block
// ───────────────────────────────────────────────
router.post(
  "/schedule/doctor/:id/weekly",
  requireRole(...WRITE_ROLES),
  async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }

    const { dayOfWeek, startTime, endTime, slotMinutes, maxPatients, notes, status } = req.body;
    if (!dayOfWeek || !startTime || !endTime) {
      res.status(400).json({ error: "dayOfWeek, startTime, endTime required" });
      return;
    }

    const [row] = await db
      .insert(doctorSchedulesTable)
      .values({
        doctorId,
        dayOfWeek,
        startTime,
        endTime,
        slotMinutes: slotMinutes ?? 30,
        maxPatients: maxPatients ?? 16,
        notes: notes ?? null,
        status: status ?? "active",
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
          status: status ?? "active",
          updatedAt: new Date(),
        },
      })
      .returning();

    await logAudit(req, "UPSERT", "doctor_schedule", row.id);
    res.status(201).json(row);
  }
);

// ───────────────────────────────────────────────
// PATCH /schedule/doctor/:id/weekly/:day/status  — toggle active/inactive
// ───────────────────────────────────────────────
router.patch(
  "/schedule/doctor/:id/weekly/:day/status",
  requireRole(...WRITE_ROLES),
  async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }
    const day = String(req.params.day);
    const { status } = req.body;
    if (status !== "active" && status !== "inactive") {
      res.status(400).json({ error: "status must be 'active' or 'inactive'" });
      return;
    }

    const [row] = await db
      .update(doctorSchedulesTable)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(doctorSchedulesTable.doctorId, doctorId),
          eq(doctorSchedulesTable.dayOfWeek, day as any)
        )
      )
      .returning();

    if (!row) { res.status(404).json({ error: "Schedule block not found" }); return; }
    await logAudit(req, "UPDATE", "doctor_schedule", row.id);
    res.json(row);
  }
);

// ───────────────────────────────────────────────
// DELETE /schedule/doctor/:id/weekly/:day
// ───────────────────────────────────────────────
router.delete(
  "/schedule/doctor/:id/weekly/:day",
  requireRole(...WRITE_ROLES),
  async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }
    const day = String(req.params.day);

    const [row] = await db
      .delete(doctorSchedulesTable)
      .where(
        and(
          eq(doctorSchedulesTable.doctorId, doctorId),
          eq(doctorSchedulesTable.dayOfWeek, day as any)
        )
      )
      .returning();

    if (!row) { res.status(404).json({ error: "Schedule block not found" }); return; }
    await logAudit(req, "DELETE", "doctor_schedule", row.id);
    res.json({ success: true });
  }
);

// ───────────────────────────────────────────────
// POST /schedule/doctor/:id/override  — upsert a date override
// ───────────────────────────────────────────────
router.post(
  "/schedule/doctor/:id/override",
  requireRole(...WRITE_ROLES),
  async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }

    const { overrideDate, isBlocked, startTime, endTime, reason } = req.body;
    if (!overrideDate || !/^\d{4}-\d{2}-\d{2}$/.test(overrideDate)) {
      res.status(400).json({ error: "overrideDate required (YYYY-MM-DD)" });
      return;
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

    await logAudit(req, "UPSERT", "schedule_override", row.id);
    res.status(201).json(row);
  }
);

// ───────────────────────────────────────────────
// DELETE /schedule/doctor/:id/override/:date
// ───────────────────────────────────────────────
router.delete(
  "/schedule/doctor/:id/override/:date",
  requireRole(...WRITE_ROLES),
  async (req: AuthRequest, res) => {
    const doctorId = safeParseInt(req.params.id);
    if (!doctorId) { res.status(400).json({ error: "Invalid doctor id" }); return; }
    const date = String(req.params.date);

    const [row] = await db
      .delete(scheduleOverridesTable)
      .where(
        and(
          eq(scheduleOverridesTable.doctorId, doctorId),
          eq(scheduleOverridesTable.overrideDate, date)
        )
      )
      .returning();

    if (!row) { res.status(404).json({ error: "Override not found" }); return; }
    await logAudit(req, "DELETE", "schedule_override", row.id);
    res.json({ success: true });
  }
);

export default router;
