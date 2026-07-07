// Extracted from billing.service.ts (Phase A clearance gate) so both
// billing.service and clearance.service can number invoices without a
// service↔service import cycle (billing.service imports clearance.service
// for the paid→settle hook).
import { runInTenantContext, clinicInvoiceCountersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// Transaction client handed to the runInTenantContext callback. Mirrors the
// pattern in lib/schedule-validator.ts so helpers can run inside the caller's tx.
export type TenantTx = Parameters<Parameters<typeof runInTenantContext>[1]>[0];

// Per-clinic atomic counter — avoids leaking cross-tenant invoice volume via
// a global sequence. UPDATE ... RETURNING is atomic; no SELECT FOR UPDATE needed.
// Runs on the caller's tx so the counter increment commits/rolls back together
// with the invoice it numbers (no gap-burning a seq on a failed create).
//
// The number embeds the clinic id (INV-<clinic>-<YYYYMM>-<seq>) because
// invoices.invoice_number is GLOBALLY unique while the counters are per
// clinic: without the clinic segment, two clinics' sequences collide the
// moment they overlap in the same month (latent multi-tenant 23505, exposed
// by the clearance-gate basket path — clinic B's INV-YYYYMM-000001 blocked
// clinic A's first invoice). Existing rows keep their old format; only the
// generator changed.
export async function generateInvoiceNumber(tx: TenantTx, clinicId: number): Promise<string> {
  const [row] = await tx
    .update(clinicInvoiceCountersTable)
    .set({ lastSeq: sql`${clinicInvoiceCountersTable.lastSeq} + 1` })
    .where(eq(clinicInvoiceCountersTable.clinicId, clinicId))
    .returning({ lastSeq: clinicInvoiceCountersTable.lastSeq });

  if (!row) {
    // First invoice for this clinic — insert the counter row and return seq 1.
    const [inserted] = await tx
      .insert(clinicInvoiceCountersTable)
      .values({ clinicId, lastSeq: 1 })
      .onConflictDoUpdate({
        target: clinicInvoiceCountersTable.clinicId,
        set: { lastSeq: sql`${clinicInvoiceCountersTable.lastSeq} + 1` },
      })
      .returning({ lastSeq: clinicInvoiceCountersTable.lastSeq });
    return formatInvoiceNumber(clinicId, inserted.lastSeq);
  }

  return formatInvoiceNumber(clinicId, row.lastSeq);
}

function formatInvoiceNumber(clinicId: number, seq: number): string {
  return `INV-${clinicId}-${formatYM()}-${String(seq).padStart(6, "0")}`;
}

function formatYM(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}
