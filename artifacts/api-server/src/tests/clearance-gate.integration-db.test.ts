/**
 * Financial clearance gate (ADR-011) — end-to-end on REAL Postgres.
 *
 * CLEARANCE_GATE_ENABLED=true for this file (set before any dynamic import so
 * the typed config picks it up). One harness per file, dynamic @workspace/db
 * imports (house integration-db rules).
 *
 * Proves:
 *  1. order create → clearance 'pending' + auto-charge on a per-patient basket
 *     invoice (kind=order_basket) priced from the catalog code;
 *  2. a second order (different modality) lands on the SAME basket, totals grow;
 *  3. workflow progress is blocked pre-payment (409 / error_code 3020);
 *  4. paying the basket flips linked orders to 'cleared' and progress succeeds;
 *  5. emergency override (doctor, reason ≥30) flips orders to 'overridden'
 *     while the invoice STAYS pending; short reason → 400;
 *  6. cross-tenant: clinic A cannot override clinic B's basket (404 via RLS/scoping);
 *  7. cancel order → its charge line is withdrawn; the emptied basket
 *     auto-cancels and the order's clearance becomes 'expired';
 *  8. the expiry sweep expires stale pending orders and cleans their baskets;
 *  9. concurrency: two parallel creates for one patient yield exactly ONE open
 *     basket (invoice_open_basket_uq race);
 * 10. imaging enum accepts 'cancelled' (migration 0041).
 *
 * Flag-OFF byte-identical behavior is proven by the entire pre-existing suite
 * (runs with the flag unset).
 */
process.env.CLEARANCE_GATE_ENABLED = "true";
process.env.CLEARANCE_TTL_HOURS = "48";

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { eq, and } from "drizzle-orm";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";

let app: any;
let signToken: any;
let harness: RealDbHarness;
let seed: CrossTenantSeed;
let invoicesTable: any;
let invoiceItemsTable: any;
let labTestsTable: any;
let xrayRecordsTable: any;
let servicesCatalogTable: any;
let expirePendingClearances: any;

const csrf = "clearance-gate-csrf-token";

beforeAll(async () => {
  harness = await startRealDb();
  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);
  const dbMod = await import("@workspace/db");
  ({ invoicesTable, invoiceItemsTable, labTestsTable, xrayRecordsTable, servicesCatalogTable } = dbMod);
  ({ default: app } = await import("../app"));
  ({ signToken } = await import("../lib/auth"));
  ({ expirePendingClearances } = await import("../modules/billing/clearance.service"));

  // Doctors may only write orders for ASSIGNED patients (0017 doctor_scope
  // RESTRICTIVE policy, WITH CHECK on INSERT). In production the link is
  // materialized by appointment creation; seed it directly here.
  await harness.db.insert(dbMod.doctorPatientsTable).values([
    { clinicId: seed.clinicA.id, doctorId: seed.doctorA.id, patientId: seed.patientA.id },
    { clinicId: seed.clinicB.id, doctorId: seed.doctorB.id, patientId: seed.patientB.id },
  ]);

  // Price the auto-charge catalog codes for clinic B (superuser write).
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

async function createLabOrder(cookie: string, patientId: number, requestedById: number, testName = "CBC") {
  return request(app)
    .post("/api/lab/tests")
    .set("Cookie", writeCookies(cookie))
    .set("X-CSRF-Token", csrf)
    .send({ patientId, requestedById, testName });
}

async function basketFor(patientId: number, clinicId: number) {
  return harness.db.select().from(invoicesTable).where(and(
    eq(invoicesTable.patientId, patientId),
    eq(invoicesTable.clinicId, clinicId),
    eq(invoicesTable.kind, "order_basket"),
    eq(invoicesTable.status, "pending"),
  ));
}

describe("clearance gate end-to-end (real Postgres)", () => {
  it("order create → pending clearance + auto-charged basket; second modality joins the same basket", async () => {
    const doctorCookie = await cookieFor(seed.doctorB, "doctor");

    const labRes = await createLabOrder(doctorCookie, seed.patientB.id, seed.doctorB.id);
    expect(labRes.status).toBe(201);
    expect(labRes.body.clearanceStatus).toBe("pending");
    expect(labRes.body.invoiceItemId).toBeTruthy();

    const baskets1 = await basketFor(seed.patientB.id, seed.clinicB.id);
    expect(baskets1.length).toBe(1);
    expect(String(baskets1[0].total)).toBe("150.00");

    const xrayRes = await request(app)
      .post("/api/xray")
      .set("Cookie", writeCookies(doctorCookie))
      .set("X-CSRF-Token", csrf)
      .send({ patientId: seed.patientB.id, requestedById: seed.doctorB.id, bodyPart: "Chest" });
    expect(xrayRes.status).toBe(201);
    expect(xrayRes.body.clearanceStatus).toBe("pending");

    const baskets2 = await basketFor(seed.patientB.id, seed.clinicB.id);
    expect(baskets2.length).toBe(1);
    expect(baskets2[0].id).toBe(baskets1[0].id);
    expect(String(baskets2[0].total)).toBe("250.00");

    const items = await harness.db.select().from(invoiceItemsTable)
      .where(eq(invoiceItemsTable.invoiceId, baskets1[0].id));
    expect(items.length).toBe(2);
    // serviceId is populated from the catalog — first code path that ever does.
    expect(items.every((i: any) => i.serviceId != null)).toBe(true);

    // 3. Workflow progress blocked pre-payment (3020).
    const adminCookie = await cookieFor(seed.superAdminB, "super_admin");
    const blocked = await request(app)
      .patch(`/api/lab/tests/${labRes.body.id}`)
      .set("Cookie", writeCookies(adminCookie))
      .set("X-CSRF-Token", csrf)
      .send({ status: "in_progress" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error_code).toBe(3020);

    // 4. FRONT DESK settles the basket (the cashier flow this gate exists for;
    //    basket creator = the ordering doctor, so the 30s creator≠payer fraud
    //    gate is unaffected) → both orders cleared, progress unblocked.
    const frontDeskCookie = await cookieFor(seed.superAdminB, "front_desk");
    const payRes = await request(app)
      .post(`/api/billing/invoices/${baskets1[0].id}/pay`)
      .set("Cookie", writeCookies(frontDeskCookie))
      .set("X-CSRF-Token", csrf)
      .send({ amountReceived: 250 });
    expect(payRes.status).toBe(200);

    const [labRow] = await harness.db.select().from(labTestsTable).where(eq(labTestsTable.id, labRes.body.id));
    expect(labRow.clearanceStatus).toBe("cleared");
    const [xrayRow] = await harness.db.select().from(xrayRecordsTable).where(eq(xrayRecordsTable.id, xrayRes.body.id));
    expect(xrayRow.clearanceStatus).toBe("cleared");

    const nowOk = await request(app)
      .patch(`/api/lab/tests/${labRes.body.id}`)
      .set("Cookie", writeCookies(adminCookie))
      .set("X-CSRF-Token", csrf)
      .send({ status: "in_progress" });
    expect(nowOk.status).toBe(200);

    // 10. Imaging 'cancelled' enum value is writable (migration 0041).
    const cancelXray = await request(app)
      .patch(`/api/xray/${xrayRes.body.id}`)
      .set("Cookie", writeCookies(adminCookie))
      .set("X-CSRF-Token", csrf)
      .send({ status: "cancelled" });
    expect(cancelXray.status).toBe(200);
    expect(cancelXray.body.status).toBe("cancelled");
  });

  it("front_desk may settle baskets but NOT manual invoices (403)", async () => {
    const frontDeskCookie = await cookieFor(seed.superAdminB, "front_desk");
    // seed.invoiceB is a manual pending invoice (kind defaults to 'manual').
    const res = await request(app)
      .post(`/api/billing/invoices/${seed.invoiceB.id}/pay`)
      .set("Cookie", writeCookies(frontDeskCookie))
      .set("X-CSRF-Token", csrf)
      .send({ amountReceived: 200 });
    expect(res.status).toBe(403);

    const [still] = await harness.db.select().from(invoicesTable).where(eq(invoicesTable.id, seed.invoiceB.id));
    expect(still.status).toBe("pending");
  });

  it("emergency override: reason ≥30 flips orders to 'overridden', invoice stays pending; short reason 400; cross-tenant 404", async () => {
    const doctorCookie = await cookieFor(seed.doctorB, "doctor");
    const res = await createLabOrder(doctorCookie, seed.patientB.id, seed.doctorB.id, "Troponin");
    expect(res.status).toBe(201);
    const [basket] = await basketFor(seed.patientB.id, seed.clinicB.id);
    expect(basket).toBeTruthy();

    const short = await request(app)
      .post(`/api/billing/invoices/${basket.id}/clearance-override`)
      .set("Cookie", writeCookies(doctorCookie))
      .set("X-CSRF-Token", csrf)
      .send({ reason: "too short" });
    expect(short.status).toBe(400);

    // Cross-tenant: clinic A doctor cannot see clinic B's basket.
    const doctorACookie = await cookieFor(seed.doctorA, "doctor");
    const cross = await request(app)
      .post(`/api/billing/invoices/${basket.id}/clearance-override`)
      .set("Cookie", writeCookies(doctorACookie))
      .set("X-CSRF-Token", csrf)
      .send({ reason: "Emergency imaging required before payment can be arranged." });
    expect(cross.status).toBe(404);

    const ok = await request(app)
      .post(`/api/billing/invoices/${basket.id}/clearance-override`)
      .set("Cookie", writeCookies(doctorCookie))
      .set("X-CSRF-Token", csrf)
      .send({ reason: "Patient in acute chest pain — troponin needed immediately, family arranging payment." });
    expect(ok.status).toBe(200);
    expect(ok.body.overriddenCount).toBe(1);

    const [labRow] = await harness.db.select().from(labTestsTable).where(eq(labTestsTable.id, res.body.id));
    expect(labRow.clearanceStatus).toBe("overridden");

    // The debt stays visible: basket is still pending.
    const [after] = await harness.db.select().from(invoicesTable).where(eq(invoicesTable.id, basket.id));
    expect(after.status).toBe("pending");

    // Settle it so later tests start from a clean open-basket slate.
    const adminCookie = await cookieFor(seed.superAdminB, "super_admin");
    const pay = await request(app)
      .post(`/api/billing/invoices/${basket.id}/pay`)
      .set("Cookie", writeCookies(adminCookie))
      .set("X-CSRF-Token", csrf)
      .send({ amountReceived: 150 });
    expect(pay.status).toBe(200);
  });

  it("cancelling the only pending order withdraws its line and auto-cancels the emptied basket", async () => {
    const doctorCookie = await cookieFor(seed.doctorB, "doctor");
    const adminCookie = await cookieFor(seed.superAdminB, "super_admin");

    const res = await createLabOrder(doctorCookie, seed.patientB.id, seed.doctorB.id, "HbA1c");
    expect(res.status).toBe(201);
    const [basket] = await basketFor(seed.patientB.id, seed.clinicB.id);
    const itemId = res.body.invoiceItemId as number;

    const cancel = await request(app)
      .patch(`/api/lab/tests/${res.body.id}`)
      .set("Cookie", writeCookies(adminCookie))
      .set("X-CSRF-Token", csrf)
      .send({ status: "cancelled" });
    expect(cancel.status).toBe(200);

    const [labRow] = await harness.db.select().from(labTestsTable).where(eq(labTestsTable.id, res.body.id));
    expect(labRow.status).toBe("cancelled");
    expect(labRow.clearanceStatus).toBe("expired");
    expect(labRow.invoiceItemId).toBeNull();

    const items = await harness.db.select().from(invoiceItemsTable).where(eq(invoiceItemsTable.id, itemId));
    expect(items.length).toBe(0);

    const [after] = await harness.db.select().from(invoicesTable).where(eq(invoicesTable.id, basket.id));
    expect(after.status).toBe("cancelled");
  });

  it("expiry sweep: stale pending orders expire and their basket is emptied + cancelled", async () => {
    const doctorCookie = await cookieFor(seed.doctorB, "doctor");
    const res = await createLabOrder(doctorCookie, seed.patientB.id, seed.doctorB.id, "Lipid Panel");
    expect(res.status).toBe(201);
    const [basket] = await basketFor(seed.patientB.id, seed.clinicB.id);

    // Backdate past the TTL (superuser write bypasses immutability concerns).
    const past = new Date(Date.now() - 72 * 3_600_000);
    await harness.db.update(labTestsTable)
      .set({ createdAt: past })
      .where(eq(labTestsTable.id, res.body.id));

    const sweep = await expirePendingClearances();
    expect(sweep.expired).toBeGreaterThanOrEqual(1);

    const [labRow] = await harness.db.select().from(labTestsTable).where(eq(labTestsTable.id, res.body.id));
    expect(labRow.clearanceStatus).toBe("expired");

    const [after] = await harness.db.select().from(invoicesTable).where(eq(invoicesTable.id, basket.id));
    expect(after.status).toBe("cancelled");
  });

  it("concurrency: two parallel order creates yield exactly one open basket", async () => {
    const doctorCookie = await cookieFor(seed.doctorA, "doctor");
    // Clinic A has no catalog rows — charges land at 0.00 (warn-logged), which
    // also exercises the missing-code fallback path.
    const [r1, r2] = await Promise.all([
      createLabOrder(doctorCookie, seed.patientA.id, seed.doctorA.id, "CBC"),
      createLabOrder(doctorCookie, seed.patientA.id, seed.doctorA.id, "CRP"),
    ]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);

    const baskets = await basketFor(seed.patientA.id, seed.clinicA.id);
    expect(baskets.length).toBe(1);

    const items = await harness.db.select().from(invoiceItemsTable)
      .where(eq(invoiceItemsTable.invoiceId, baskets[0].id));
    expect(items.length).toBe(2);
  });
});
