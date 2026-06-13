import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { clinicsTable } from "./clinics";
import { usersTable } from "./users";
import { uuidV7 } from "../uuid-v7";

export const clinicNoticesTable = pgTable("clinic_notices", {
  id: uuid("id").$defaultFn(uuidV7).primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdBy: integer("created_by").notNull().references(() => usersTable.id),
  reason: text("reason").notNull(),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("cn_clinic_idx").on(t.clinicId),
  index("cn_created_idx").on(t.createdAt),
]);

export type ClinicNotice = typeof clinicNoticesTable.$inferSelect;
