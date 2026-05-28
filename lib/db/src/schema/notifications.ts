import { pgTable, serial, text, integer, timestamp, boolean, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { clinicsTable } from "./clinics";

export const notificationTypeEnum = pgEnum("notification_type", [
  "patient_arrived",
  "lab_ready",
  "xray_ready",
  "ultrasound_ready",
  "general",
]);

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().default(1).references(() => clinicsTable.id),
  userId: integer("user_id").notNull().references(() => usersTable.id),
  title: text("title").notNull(),
  message: text("message").notNull(),
  type: notificationTypeEnum("type").notNull().default("general"),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("notif_user_idx").on(t.userId),
  index("notif_read_idx").on(t.isRead),
  index("notif_created_idx").on(t.createdAt),
  index("notif_clinic_idx").on(t.clinicId),
]);

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
  clinicId: true,
  createdAt: true,
});

export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
