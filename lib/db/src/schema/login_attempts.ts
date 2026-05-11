import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";

export const loginAttemptsTable = pgTable("login_attempts", {
  key:         text("key").primaryKey(),
  count:       integer("count").notNull().default(0),
  firstSeen:   timestamp("first_seen", { withTimezone: true }).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).notNull(),
});
