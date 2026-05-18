import { pgTable, serial, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => usersTable.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id"),
  ipAddress: text("ip_address").notNull(),
  userAgent: text("user_agent"),
  details: jsonb("details"),
  requestId: text("request_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => {
  return {
    entityIdx: index("audit_entity_idx").on(table.entityType, table.entityId),
    userIdx: index("audit_user_idx").on(table.userId, table.createdAt),
  };
});

export const insertAuditLogSchema = createInsertSchema(auditLogsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;
export type AuditLog = typeof auditLogsTable.$inferSelect;
