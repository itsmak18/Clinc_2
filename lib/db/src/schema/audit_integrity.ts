import { pgTable, serial, integer, text, date, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const auditIntegrityChecksTable = pgTable(
  "audit_integrity_checks",
  {
    id: serial("id").primaryKey(),
    /** ISO date string "YYYY-MM-DD" of the day covered by this hash record. */
    checkedDate: date("checked_date", { mode: "string" }).notNull(),
    rowCount: integer("row_count").notNull(),
    /** SHA-256 hex of (prevHash + all audit_log rows for the day ordered by id ASC). */
    rootHash: text("root_hash").notNull(),
    /** rootHash of the previous day's record, or "genesis" for the first record. */
    prevHash: text("prev_hash").notNull(),
    status: text("status").notNull().$type<"ok" | "empty" | "mismatch">(),
    /** Set when verifyIntegrity() re-runs the check against the stored prevHash. */
    verifiedAt: timestamp("verified_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("audit_integrity_date_idx").on(table.checkedDate),
  ],
);
