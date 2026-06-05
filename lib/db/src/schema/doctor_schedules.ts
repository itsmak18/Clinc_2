import { pgTable, serial, integer, text, boolean, timestamp, pgEnum, time, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { clinicsTable } from "./clinics";

export const dayOfWeekEnum = pgEnum("day_of_week", [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
]);

export const scheduleStatusEnum = pgEnum("schedule_status", ["active", "inactive"]);

export const doctorSchedulesTable = pgTable("doctor_schedules", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  doctorId: integer("doctor_id").notNull().references(() => usersTable.id),
  dayOfWeek: dayOfWeekEnum("day_of_week").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  slotMinutes: integer("slot_minutes").notNull().default(30),
  maxPatients: integer("max_patients").notNull().default(16),
  status: scheduleStatusEnum("status").notNull().default("active"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("doctor_schedule_unique").on(t.doctorId, t.dayOfWeek),
]);

export const scheduleOverridesTable = pgTable("schedule_overrides", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  doctorId: integer("doctor_id").notNull().references(() => usersTable.id),
  overrideDate: text("override_date").notNull(), // YYYY-MM-DD
  isBlocked: boolean("is_blocked").notNull().default(false),
  startTime: time("start_time"),
  endTime: time("end_time"),
  reason: text("reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  unique("override_unique").on(t.doctorId, t.overrideDate),
]);

export const insertDoctorScheduleSchema = createInsertSchema(doctorSchedulesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertScheduleOverrideSchema = createInsertSchema(scheduleOverridesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertDoctorSchedule = z.infer<typeof insertDoctorScheduleSchema>;
export type DoctorSchedule = typeof doctorSchedulesTable.$inferSelect;
export type InsertScheduleOverride = z.infer<typeof insertScheduleOverrideSchema>;
export type ScheduleOverride = typeof scheduleOverridesTable.$inferSelect;
