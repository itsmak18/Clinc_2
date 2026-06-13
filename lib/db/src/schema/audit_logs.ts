import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { clinicsTable } from "./clinics";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  userId: integer("user_id").references(() => usersTable.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  details: jsonb("details"),
  beforeState: jsonb("before_state"),
  afterState: jsonb("after_state"),
  requestId: text("request_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => {
  return {
    entityIdx: index("audit_entity_idx").on(table.entityType, table.entityId),
    entityTimeIdx: index("audit_entity_time_idx").on(table.entityType, table.entityId, table.createdAt),
    userIdx: index("audit_user_idx").on(table.userId, table.createdAt),
    createdAtIdx: index("audit_created_at_idx").on(table.createdAt),
    clinicIdx: index("audit_clinic_idx").on(table.clinicId),
  };
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  id: true,
  clinicId: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
