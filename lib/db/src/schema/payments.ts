import { pgTable, uuid, integer, bigint, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { clinicsTable } from "./clinics";
import { invoicesTable } from "./billing";
import { usersTable } from "./users";
import { uuidV7 } from "../uuid-v7";

export const paymentMethodEnum = pgEnum("payment_method", [
  "cash",
  "card",
  "transfer",
  "adjustment", // refund / correction — carried as a negative amount
]);

/**
 * Append-only payments ledger (audit finding F-02).
 *
 * Previously an invoice had a single `status` enum (pending → paid) and no record
 * of money actually received — refunds, partial payments, and per-transaction
 * reconciliation were impossible to reconstruct. This table is the financial
 * record of truth: one immutable row per payment event. Invoice `paid` state is
 * derived from `SUM(amount_cents) >= invoice total`, not a bare flag.
 *
 * Money is stored in integer minor units (cents, bigint) — exact, no float. A
 * positive amount is money received; a negative amount is a refund/adjustment.
 * Append-only: migration revokes UPDATE/DELETE from the runtime role, mirroring
 * audit_logs — corrections are new rows, never edits.
 */
export const paymentsTable = pgTable("payments", {
  id: uuid("id").$defaultFn(uuidV7).primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  invoiceId: integer("invoice_id").notNull().references(() => invoicesTable.id),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  method: paymentMethodEnum("method").notNull(),
  receivedById: integer("received_by_id").notNull().references(() => usersTable.id),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  externalRef: text("external_ref"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("payments_invoice_idx").on(t.invoiceId),
  index("payments_clinic_idx").on(t.clinicId),
]);

export type Payment = typeof paymentsTable.$inferSelect;
