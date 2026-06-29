/**
 * createInvoice atomicity regression (REAL Postgres).
 *
 * The bug: createInvoice wrote the invoice header and the line items as two
 * separate `db.insert` statements with NO enclosing transaction. A failure
 * between them (DB error on the items insert) left an ORPHAN invoice header
 * with zero line items — and a burned invoice-sequence number — corrupting
 * daily reconciliation. The fix wraps the patient check + counter increment +
 * header insert + items insert in a single runInTenantContext transaction, so
 * the whole create commits or rolls back as a unit.
 *
 * Deterministic failure trigger: `quantity` is `zod.number()` at the route
 * (unbounded) and `int().positive()` in the service (no upper bound), but the
 * `invoice_items.quantity` column is int4 (max 2_147_483_647). An item with
 * `quantity = 3_000_000_000, unitPrice = 0` therefore:
 *   - passes route + service validation,
 *   - yields subtotal/total = 0, so the HEADER insert succeeds (and the counter
 *     advances) inside the tx,
 *   - then OVERFLOWS int4 at the line-items insert → Postgres "integer out of
 *     range" (22003) → the transaction rolls back.
 * Pre-fix this left an orphan header. Post-fix: zero new rows.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker (or INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";

let app: any;
let signToken: any;
let harness: RealDbHarness;
let seed: CrossTenantSeed;
let invoicesTable: any;
let invoiceItemsTable: any;

const csrf = "invoice-atomicity-csrf-token";

beforeAll(async () => {
  harness = await startRealDb();
  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);
  ({ invoicesTable, invoiceItemsTable } = await import("@workspace/db"));
  ({ default: app } = await import("../app"));
  ({ signToken } = await import("../lib/auth"));
}, 180_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

async function cookieFor(user: { id: number; username: string; clinicId: number }, role: string): Promise<string> {
  const token = await signToken({ userId: user.id, username: user.username, role, clinicId: user.clinicId });
  return `clinic_token=${token}`;
}
const writeCookies = (authCookie: string) => [authCookie, `_csrf=${csrf}`];

// Direct superuser reads (harness.db bypasses RLS) — count rows physically present.
async function countInvoices(clinicId: number): Promise<number> {
  const rows = await harness.db.select().from(invoicesTable).where(eq(invoicesTable.clinicId, clinicId));
  return rows.length;
}
async function countInvoiceItems(clinicId: number): Promise<number> {
  const rows = await harness.db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.clinicId, clinicId));
  return rows.length;
}

describe("createInvoice is atomic: a failed line-items insert leaves no orphan header (real Postgres)", () => {
  it("rolls back the header + counter when the items insert errors", async () => {
    const clinicId = seed.clinicB.id;
    const cookie = await cookieFor(seed.superAdminB, "super_admin");

    const invoicesBefore = await countInvoices(clinicId);
    const itemsBefore = await countInvoiceItems(clinicId);

    // quantity overflows int4 at the items insert; subtotal/total stay 0 so the
    // header insert itself is valid — this is the exact "header ok, items fail"
    // shape that previously orphaned a header.
    const res = await request(app)
      .post("/api/billing/invoices")
      .set("Cookie", writeCookies(cookie))
      .set("X-CSRF-Token", csrf)
      .send({
        patientId: seed.patientB.id,
        items: [{ description: "int4 overflow", quantity: 3_000_000_000, unitPrice: 0 }],
      });

    // The request must fail (DB error surfaces as a 5xx envelope), NOT 201.
    expect(res.status).not.toBe(201);
    expect(res.status).toBeGreaterThanOrEqual(400);

    // Atomicity: no new header, no new items persisted.
    expect(await countInvoices(clinicId)).toBe(invoicesBefore);
    expect(await countInvoiceItems(clinicId)).toBe(itemsBefore);
  });

  it("a normal invoice still succeeds afterward (DB + counter left usable)", async () => {
    const clinicId = seed.clinicB.id;
    const cookie = await cookieFor(seed.superAdminB, "super_admin");

    const res = await request(app)
      .post("/api/billing/invoices")
      .set("Cookie", writeCookies(cookie))
      .set("X-CSRF-Token", csrf)
      .send({
        patientId: seed.patientB.id,
        items: [{ description: "Consultation", quantity: 1, unitPrice: 50 }],
      });

    expect(res.status).toBe(201);
    const invoiceId = res.body.id as number;
    const items = await harness.db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.invoiceId, invoiceId));
    expect(items.length).toBe(1);
    expect(items[0].clinicId).toBe(clinicId);
  });
});
