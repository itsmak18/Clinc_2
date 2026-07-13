/**
 * Invoice writer serialization (ADR-011 §11) — REAL Postgres.
 *
 * Race regressions found by the 2026-07-12 external audit, both confirmed in
 * code before fixing:
 *   1. recordPayment took no lock on MANUAL invoices (advisory lock is
 *      basket-only), so two concurrent payments read the same ledger SUM,
 *      both validated against it, and the append-only ledger ended up over
 *      the invoice total.
 *   2. cancelInvoice took no basket advisory lock, so an order created
 *      concurrently with a basket cancel could land its charge line after
 *      settleInvoiceOrders scanned the basket — stranding the order at
 *      clearance_status='pending' on a CANCELLED invoice until the TTL sweep.
 *
 * Fix under test: every invoice writer (payInvoice / recordPayment /
 * cancelInvoice) re-reads the invoice FOR UPDATE after the (basket-only)
 * advisory lock; the ledger SUM runs under that row lock. Lock order is
 * always advisory → row; the initial kind/patient read never locks.
 *
 * Loser-behavior contract: the losing side of a serialized payment race must
 * fail with the documented overpayment ValidationError (clean 400) — not a
 * lock timeout or serialization error surfacing as a 500. Asserted here.
 *
 * RED-RUN PROOF: these tests were run once against the pre-fix code
 * (fix stashed) and observed failing before being trusted green — see the PR.
 *
 * CLEARANCE_GATE_ENABLED=true (set before any dynamic import) because the
 * append-vs-cancel race needs auto-charged baskets. The manual-invoice tests
 * are flag-independent. One harness per file, dynamic @workspace/db imports
 * (house integration-db rules).
 */
process.env.CLEARANCE_GATE_ENABLED = "true";
process.env.CLEARANCE_TTL_HOURS = "48";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq, and, sql } from "drizzle-orm";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";

let app: any;
let signToken: any;
let harness: RealDbHarness;
let seed: CrossTenantSeed;
let invoicesTable: any;
let usersTable: any;
let servicesCatalogTable: any;
let adminA: { id: number; username: string };

const csrf = "billing-concurrency-csrf-token";

beforeAll(async () => {
  harness = await startRealDb();
  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);
  const dbMod = await import("@workspace/db");
  ({ invoicesTable, usersTable, servicesCatalogTable } = dbMod);
  ({ default: app } = await import("../app"));
  ({ signToken } = await import("../lib/auth"));

  // Second clinic-A staffer so payInvoice clears the same-user-within-30s
  // anti-fraud gate (creator = super_admin, payer = admin).
  const inserted = (await harness.db
    .insert(usersTable)
    .values({ username: "admin_a_conc", fullName: "Admin A Conc", passwordHash: "x", role: "admin", clinicId: seed.clinicA.id })
    .returning()) as Array<{ id: number; username: string }>;
  adminA = { id: inserted[0].id, username: inserted[0].username };

  // Doctor→patient scope link (0017 RESTRICTIVE policy) + priced catalog codes
  // for clinic B, so flag-ON order creates auto-charge a basket.
  await harness.db.insert(dbMod.doctorPatientsTable).values([
    { clinicId: seed.clinicB.id, doctorId: seed.doctorB.id, patientId: seed.patientB.id },
  ]);
  await harness.db.insert(servicesCatalogTable).values([
    { clinicId: seed.clinicB.id, name: "Lab Test (default)", defaultPrice: "150.00", category: "lab", code: "LAB_DEFAULT" },
    { clinicId: seed.clinicB.id, name: "X-Ray (default)", defaultPrice: "100.00", category: "xray", code: "XRAY_DEFAULT" },
  ]);
}, 180_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

async function cookieFor(user: { id: number; username: string; clinicId: number }, role: string): Promise<string> {
  const token = await signToken({ userId: user.id, username: user.username, role, clinicId: user.clinicId });
  return `clinic_token=${token}`;
}
const writeCookies = (authCookie: string) => [authCookie, `_csrf=${csrf}`];

// The looped scenarios exceed the global mutation limiter's per-IP budget
// (app.ts: ipRateLimit(100, 15min)). `trust proxy` covers loopback, so a
// TEST-NET X-Forwarded-For per iteration gives each loop turn its own rate
// bucket — same as distinct clients in production. No prod config touched.
async function createManualInvoice(cookie: string, patientId: number, unitPrice: number, ip: string): Promise<number> {
  const res = await request(app)
    .post("/api/billing/invoices")
    .set("Cookie", writeCookies(cookie))
    .set("X-CSRF-Token", csrf)
    .set("X-Forwarded-For", ip)
    .send({ patientId, items: [{ description: "svc", quantity: 1, unitPrice }] });
  expect(res.status).toBe(201);
  return res.body.id as number;
}

function recordPayment(invoiceId: number, cookie: string, amount: number, ip: string, method = "cash") {
  return request(app)
    .post(`/api/billing/invoices/${invoiceId}/payments`)
    .set("Cookie", writeCookies(cookie))
    .set("X-CSRF-Token", csrf)
    .set("X-Forwarded-For", ip)
    .send({ amount, method });
}

function payInvoice(invoiceId: number, cookie: string, amountReceived: number, ip: string) {
  return request(app)
    .post(`/api/billing/invoices/${invoiceId}/pay`)
    .set("Cookie", writeCookies(cookie))
    .set("X-CSRF-Token", csrf)
    .set("X-Forwarded-For", ip)
    .send({ amountReceived });
}

function cancelInvoice(invoiceId: number, cookie: string, ip: string) {
  return request(app)
    .post(`/api/billing/invoices/${invoiceId}/cancel`)
    .set("Cookie", writeCookies(cookie))
    .set("X-CSRF-Token", csrf)
    .set("X-Forwarded-For", ip)
    .send({ reason: "concurrency drill — cancelled while an order append is in flight" });
}

function getLedger(invoiceId: number, cookie: string) {
  return request(app).get(`/api/billing/invoices/${invoiceId}/payments`).set("Cookie", [cookie]);
}

async function pendingBasketsFor(patientId: number, clinicId: number) {
  return harness.db.select().from(invoicesTable).where(and(
    eq(invoicesTable.patientId, patientId),
    eq(invoicesTable.clinicId, clinicId),
    eq(invoicesTable.kind, "order_basket"),
    eq(invoicesTable.status, "pending"),
  ));
}

/** The stranded-state invariant: no order may sit at clearance='pending' with
 *  its charge line on a CANCELLED invoice (superuser query — bypasses RLS). */
async function strandedOrders() {
  const res: any = await harness.db.execute(sql`
    SELECT 'lab' AS modality, o.id FROM lab_tests o
      JOIN invoice_items ii ON ii.id = o.invoice_item_id
      JOIN invoices i ON i.id = ii.invoice_id
     WHERE o.clearance_status = 'pending' AND i.status = 'cancelled'
    UNION ALL
    SELECT 'xray' AS modality, o.id FROM xray_records o
      JOIN invoice_items ii ON ii.id = o.invoice_item_id
      JOIN invoices i ON i.id = ii.invoice_id
     WHERE o.clearance_status = 'pending' AND i.status = 'cancelled'
  `);
  return res.rows ?? res;
}

describe("invoice writer serialization (ADR-011 §11, real Postgres)", () => {
  it("two concurrent full payments on a MANUAL invoice: one clean 400, ledger never exceeds total", async () => {
    const sa = await cookieFor(seed.superAdminA, "super_admin");

    // The critical window (SUM → validate → insert) is a few ms wide, so a
    // single shot can miss the interleaving on pre-fix code (it did, on the
    // red run). Fresh invoice + concurrent pair per iteration; the invariant
    // must hold on EVERY iteration.
    for (let i = 0; i < 20; i++) {
      const ip = `198.51.100.${i + 1}`;
      const invoiceId = await createManualInvoice(sa, seed.patientA.id, 100, ip);
      const [r1, r2] = await Promise.all([
        recordPayment(invoiceId, sa, 100, ip),
        recordPayment(invoiceId, sa, 100, ip),
      ]);

      // Exactly one winner; the loser fails with the documented overpayment
      // rejection (clean 400) — not a lock timeout / serialization 500.
      expect([r1.status, r2.status].sort()).toEqual([201, 400]);
      const loser = r1.status === 400 ? r1 : r2;
      expect(loser.body.message).toMatch(/exceeds the outstanding balance/);

      const ledger = await getLedger(invoiceId, sa);
      expect(ledger.status).toBe(200);
      expect(ledger.body.status).toBe("paid");
      expect(ledger.body.amountPaid).toBe(100); // NOT 200 — the pre-fix failure
      expect(ledger.body.payments).toHaveLength(1);
    }
  }, 120_000);

  it("payInvoice concurrent with a partial recordPayment on a MANUAL invoice: ledger sums exactly to total", async () => {
    const sa = await cookieFor(seed.superAdminA, "super_admin");
    const adminCookie = await cookieFor({ ...adminA, clinicId: seed.clinicA.id }, "admin");

    // Looped for the same reason as above: which side lands first is a coin
    // flip per iteration, and the pre-fix failure (payInvoice stacking the
    // full total on top of a partial) only shows in the partial-first order.
    for (let i = 0; i < 10; i++) {
      const ip = `198.51.100.${100 + i}`;
      const invoiceId = await createManualInvoice(sa, seed.patientA.id, 100, ip);
      const [pay, partial] = await Promise.all([
        payInvoice(invoiceId, adminCookie, 100, ip),
        recordPayment(invoiceId, sa, 60, ip),
      ]);

      // payInvoice settles the OUTSTANDING BALANCE under the row lock, so it
      // succeeds in either serialization order. The partial either lands
      // first (payInvoice then pays the remaining 40) or arrives after
      // 'paid' and is rejected as overpayment — never stacked on top.
      expect(pay.status).toBe(200);
      expect([201, 400]).toContain(partial.status);
      if (partial.status === 400) {
        expect(partial.body.message).toMatch(/exceeds the outstanding balance/);
      }

      const ledger = await getLedger(invoiceId, sa);
      expect(ledger.body.status).toBe("paid");
      expect(ledger.body.amountPaid).toBe(100); // invariant: SUM(ledger) == total, both orders
    }
  }, 120_000);

  it("basket cancel concurrent with an order append never strands a pending order on a cancelled invoice", async () => {
    const doctorCookie = await cookieFor(seed.doctorB, "doctor");
    const saB = await cookieFor(seed.superAdminB, "super_admin");

    // Not deterministic interleaving (the services own their transactions, so
    // a mid-tx pause can't be injected without refactoring); 50 genuinely
    // parallel iterations instead. Observed failing pre-fix (see red-run note
    // in the header) — do not shrink the iteration count.
    const ITERATIONS = 50;
    for (let i = 0; i < ITERATIONS; i++) {
      const ip = `203.0.113.${i + 1}`;
      const lab = await request(app)
        .post("/api/lab/tests")
        .set("Cookie", writeCookies(doctorCookie))
        .set("X-CSRF-Token", csrf)
        .set("X-Forwarded-For", ip)
        .send({ patientId: seed.patientB.id, requestedById: seed.doctorB.id, testName: `CBC-${i}` });
      expect(lab.status).toBe(201);

      const baskets = await pendingBasketsFor(seed.patientB.id, seed.clinicB.id);
      expect(baskets).toHaveLength(1);

      // The race: append an x-ray order while the basket is being cancelled.
      const [xrayRes, cancelRes] = await Promise.all([
        request(app)
          .post("/api/xray")
          .set("Cookie", writeCookies(doctorCookie))
          .set("X-CSRF-Token", csrf)
          .set("X-Forwarded-For", ip)
          .send({ patientId: seed.patientB.id, requestedById: seed.doctorB.id, bodyPart: `Chest-${i}` }),
        cancelInvoice(baskets[0].id, saB, ip),
      ]);
      expect(xrayRes.status).toBe(201);
      expect(cancelRes.status).toBe(200);

      // THE invariant (pre-fix this trips within the loop): a pending-
      // clearance order must never point at a cancelled invoice's line.
      const stranded = await strandedOrders();
      expect(stranded).toEqual([]);

      // Reset for the next iteration: if the x-ray append serialized AFTER
      // the cancel it opened a fresh basket — cancel it so each iteration
      // starts from zero open baskets.
      const leftovers = await pendingBasketsFor(seed.patientB.id, seed.clinicB.id);
      for (const b of leftovers) {
        const c = await cancelInvoice(b.id, saB, ip);
        expect(c.status).toBe(200);
      }
    }
  }, 240_000);
});
