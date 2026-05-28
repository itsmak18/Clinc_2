import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  integer,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

// One row per (user, device). `device_id` is the value stored in the __Host-
// device cookie; `fingerprint_hash` is HMAC(server_secret, user_id || UA-family
// || screen || tz) so a DB leak cannot correlate the same browser across
// users. ASN / country are NOT part of identity — they are risk signals only.

export const userDevicesTable = pgTable(
  "user_devices",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    deviceId: uuid("device_id").notNull(),
    fingerprintHash: text("fingerprint_hash").notNull(),
    ipLast: text("ip_last"),
    asnLast: integer("asn_last"),
    countryLast: text("country_last"),
    firstSeen: timestamp("first_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true })
      .notNull()
      .defaultNow(),
    trusted: boolean("trusted").notNull().default(false),
    /** 'first_login' | 'email_confirmed' | 'admin_approved' | 'grandfathered' */
    trustSource: text("trust_source"),
    trustExpiresAt: timestamp("trust_expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.userId, table.deviceId] }),
      fingerprintIdx: index("user_devices_fingerprint_idx").on(
        table.userId,
        table.fingerprintHash,
      ),
      trustExpiryIdx: index("user_devices_trust_expiry_idx").on(
        table.trustExpiresAt,
      ),
    };
  },
);

export const insertUserDeviceSchema = createInsertSchema(userDevicesTable).omit({
  firstSeen: true,
  lastSeen: true,
});

export type InsertUserDevice = z.infer<typeof insertUserDeviceSchema>;
export type UserDevice = typeof userDevicesTable.$inferSelect;
