import {
  pgTable,
  serial,
  text,
  integer,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Raw CSP violation reports posted to /api/csp-report. Stored separately from
// audit_logs because they are noisy, low-signal-per-row, and need their own
// retention (90 days is enough — these don't need 7-year HIPAA retention).

export const cspReportsTable = pgTable(
  "csp_reports",
  {
    id: serial("id").primaryKey(),
    documentUri: text("document_uri"),
    referrer: text("referrer"),
    violatedDirective: text("violated_directive"),
    effectiveDirective: text("effective_directive"),
    originalPolicy: text("original_policy"),
    disposition: text("disposition"),
    blockedUri: text("blocked_uri"),
    statusCode: integer("status_code"),
    sourceFile: text("source_file"),
    lineNumber: integer("line_number"),
    columnNumber: integer("column_number"),
    scriptSample: text("script_sample"),
    raw: jsonb("raw"),
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      directiveIdx: index("csp_reports_directive_idx").on(
        table.violatedDirective,
        table.createdAt,
      ),
      createdAtIdx: index("csp_reports_created_at_idx").on(table.createdAt),
    };
  },
);

export const insertCspReportSchema = createInsertSchema(cspReportsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertCspReport = z.infer<typeof insertCspReportSchema>;
export type CspReport = typeof cspReportsTable.$inferSelect;
