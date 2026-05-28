import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Phase 2 — password-reset tokens. Same pattern as device_verification_tokens:
// raw token only in the email; DB stores SHA-256 hash. Atomic single-use.

export const passwordResetTokensTable = pgTable(
  "password_reset_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    /** 'self_service' | 'admin_reset' — admin-reset forces change on next login. */
    source: text("source").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      userIdx: index("password_reset_tokens_user_idx").on(
        table.userId,
        table.createdAt,
      ),
    };
  },
);

export const insertPasswordResetTokenSchema = createInsertSchema(
  passwordResetTokensTable,
).omit({ id: true, createdAt: true, consumedAt: true });

export type InsertPasswordResetToken = z.infer<
  typeof insertPasswordResetTokenSchema
>;
export type PasswordResetToken = typeof passwordResetTokensTable.$inferSelect;
