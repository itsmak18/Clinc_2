import {
  pgTable,
  serial,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// Single-use verification tokens emailed on new-device login. We store only
// `token_hash` (SHA-256 of the raw token); the raw token only ever exists in
// the email body. `fingerprint_hash` binds the token to the device that
// triggered login — clicking from a different device fails closed.
//
// Atomic consume: `UPDATE … SET consumed_at = now() WHERE consumed_at IS NULL
// AND expires_at > now() RETURNING id`. A second click finds consumed_at
// already set and returns zero rows.

export const deviceVerificationTokensTable = pgTable(
  "device_verification_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    pendingDeviceId: uuid("pending_device_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    fingerprintHash: text("fingerprint_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      userIdx: index("device_verification_tokens_user_idx").on(
        table.userId,
        table.createdAt,
      ),
      fingerprintIdx: index("device_verification_tokens_fp_idx").on(
        table.userId,
        table.fingerprintHash,
      ),
    };
  },
);

export const insertDeviceVerificationTokenSchema = createInsertSchema(
  deviceVerificationTokensTable,
).omit({ id: true, createdAt: true, consumedAt: true });

export type InsertDeviceVerificationToken = z.infer<
  typeof insertDeviceVerificationTokenSchema
>;
export type DeviceVerificationToken =
  typeof deviceVerificationTokensTable.$inferSelect;
