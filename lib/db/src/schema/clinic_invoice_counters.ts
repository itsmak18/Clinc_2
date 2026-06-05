import { pgTable, integer, bigint } from "drizzle-orm/pg-core";
import { clinicsTable } from "./clinics";

export const clinicInvoiceCountersTable = pgTable("clinic_invoice_counters", {
  clinicId: integer("clinic_id").primaryKey().references(() => clinicsTable.id),
  lastSeq:  bigint("last_seq", { mode: "number" }).notNull().default(0),
});

export type ClinicInvoiceCounter = typeof clinicInvoiceCountersTable.$inferSelect;
