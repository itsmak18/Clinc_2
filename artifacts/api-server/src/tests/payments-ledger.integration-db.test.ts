/**
 * Payments ledger (F-02) — REAL Postgres.
 *
 * Proves the append-only payments ledger end-to-end:
 *   - partial payments accumulate and flip the invoice to `paid` only when the
 *     ledger sum covers the total (status derived from the ledger, not a flag);
 *   - overpayment and over-refund are rejected;
 *   - a negative `adjustment` (refund) drops a paid invoice back to `pending`;
 *   - the fast-payment paths (createInvoice markPaid, payInvoice) also write a
 *     ledger row, so every paid invoice's ledger sums to its total;
 *   - tenant isolation: a clinic cannot read another clinic's ledger;
 *   - append-only: the runtime role (medicore_app) cannot UPDATE/DELETE payments.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker (or INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";

let app: any;
let signToken: any;
let harness: RealDbHarness;
let seed: CrossTenantSeed;
let usersTable: any;
let adminA: { id: number; username: string };

const csrf = "payments-ledger-csrf-token";

beforeAll(async () => {
  harness = await startRealDb();
  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);
  ({ usersTable } = await import("@workspace/db"));
  ({ default: app } = await import("../app"));
  ({ signToken } = await import("../lib/auth"));

  // A second clinic-A staffer so payInvoice can be exercised without tripping the
  // same-user-within-30s anti-fraud gate (creator = super_admin, payer = admin).
  const inserted = (await harness.db
    .insert(usersTable)
    .values({ username: "admin_a_pay", fullName: "Admin A", passwordHash: "x", role: "admin", clinicId: seed.clinicA.id })
    .returning()) as Array<{ id: number; username: string }>;
  adminA = { id: inserted[0].id, username: inserted[0].username };
}, 180_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

async function cookieFor(user: { id: number; username: string; clinicId: number }, role: string): Promise<string> {
  const token = await signToken({ userId: user.id, username: user.username, role, clinicId: user.clinicId });
  return `clinic_token=${token}`;
}
const writeCookies = (authCookie: string) => [authCookie, `_csrf=${csrf}`];

async function createPendingInvoice(cookie: string, patientId: number, unitPrice: number, markPaid = false): Promise<number> {
  const res = await request(app)
    .post("/api/billing/invoices")
    .set("Cookie", writeCookies(cookie))
    .set("X-CSRF-Token", csrf)
    .send({ patientId, items: [{ description: "svc", quantity: 1, unitPrice }], markPaid });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

function recordPayment(invoiceId: number, cookie: string, amount: number, method = "cash") {
  return request(app)
    .post(`/api/billing/invoices/${invoiceId}/payments`)
    .set("Cookie", writeCookies(cookie))
    .set("X-CSRF-Token", csrf)
    .send({ amount, method });
}

function getLedger(invoiceId: number, cookie: string) {
  return request(app).get(`/api/billing/invoices/${invoiceId}/payments`).set("Cookie", [cookie]);
}

describe("Payments ledger (F-02, real Postgres)", () => {
  it("partial payments accumulate; invoice flips to paid only when the ledger covers the total", async () => {
    const sa = await cookieFor(seed.superAdminA, "super_admin");
    const invoiceId = await createPendingInvoice(sa, seed.patientA.id, 100);

    const first = await recordPayment(invoiceId, sa, 60);
    expect(first.status).toBe(201);
    expect(first.body.invoiceStatus).toBe("pending");
    expect(first.body.balance).toBe(40);

    const second = await recordPayment(invoiceId, sa, 40);
    expect(second.status).toBe(201);
    expect(second.body.invoiceStatus).toBe("paid");
    expect(second.body.balance).toBe(0);

    const ledger = await getLedger(invoiceId, sa);
    expect(ledger.status).toBe(200);
    expect(ledger.body.status).toBe("paid");
    expect(ledger.body.amountPaid).toBe(100);
    expect(ledger.body.payments).toHaveLength(2);
  });

  it("rejects a payment that exceeds the outstanding balance", async () => {
    const sa = await cookieFor(seed.superAdminA, "super_admin");
    const invoiceId = await createPendingInvoice(sa, seed.patientA.id, 100);
    const over = await recordPayment(invoiceId, sa, 150);
    expect(over.status).toBeGreaterThanOrEqual(400);
    expect(over.status).toBeLessThan(500);
  });

  it("a refund (negative adjustment) drops a paid invoice back to pending", async () => {
    const sa = await cookieFor(seed.superAdminA, "super_admin");
    const invoiceId = await createPendingInvoice(sa, seed.patientA.id, 100);
    await recordPayment(invoiceId, sa, 100); // fully paid

    const refund = await recordPayment(invoiceId, sa, -30, "adjustment");
    expect(refund.status).toBe(201);
    expect(refund.body.invoiceStatus).toBe("pending");
    expect(refund.body.balance).toBe(30);

    // A positive payment cannot be negative under a non-adjustment method.
    const badRefund = await recordPayment(invoiceId, sa, -10, "cash");
    expect(badRefund.status).toBeGreaterThanOrEqual(400);
  });

  it("createInvoice(markPaid) writes a ledger row so the ledger is complete", async () => {
    const sa = await cookieFor(seed.superAdminA, "super_admin");
    const invoiceId = await createPendingInvoice(sa, seed.patientA.id, 50, true);
    const ledger = await getLedger(invoiceId, sa);
    expect(ledger.body.status).toBe("paid");
    expect(ledger.body.amountPaid).toBe(50);
    expect(ledger.body.payments).toHaveLength(1);
  });

  it("payInvoice writes a ledger row (paid by a second staffer to clear the SoD gate)", async () => {
    const sa = await cookieFor(seed.superAdminA, "super_admin");
    const invoiceId = await createPendingInvoice(sa, seed.patientA.id, 75);
    const adminCookie = await cookieFor({ ...adminA, clinicId: seed.clinicA.id }, "admin");
    const pay = await request(app)
      .post(`/api/billing/invoices/${invoiceId}/pay`)
      .set("Cookie", writeCookies(adminCookie))
      .set("X-CSRF-Token", csrf)
      .send({ amountReceived: 75 });
    expect(pay.status).toBe(200);

    const ledger = await getLedger(invoiceId, sa);
    expect(ledger.body.status).toBe("paid");
    expect(ledger.body.amountPaid).toBe(75);
    expect(ledger.body.payments).toHaveLength(1);
  });

  it("tenant isolation: a clinic cannot read another clinic's payment ledger", async () => {
    const sa = await cookieFor(seed.superAdminA, "super_admin");
    const invoiceId = await createPendingInvoice(sa, seed.patientA.id, 100);
    await recordPayment(invoiceId, sa, 100);

    const clinicBSuper = await cookieFor(seed.superAdminB, "super_admin");
    const cross = await getLedger(invoiceId, clinicBSuper);
    expect(cross.status).toBe(404); // clinic B never sees clinic A's invoice
  });

  it("append-only: the runtime role cannot UPDATE or DELETE payments", async () => {
    const sa = await cookieFor(seed.superAdminA, "super_admin");
    const invoiceId = await createPendingInvoice(sa, seed.patientA.id, 20);
    await recordPayment(invoiceId, sa, 20);

    // harness.pool connects as medicore_app (the runtime role). Migration 0040
    // revoked UPDATE/DELETE, so these must fail with "permission denied".
    await expect(harness.pool.query("UPDATE payments SET notes = 'tampered'")).rejects.toThrow(/permission denied/i);
    await expect(harness.pool.query("DELETE FROM payments")).rejects.toThrow(/permission denied/i);
  });
});
