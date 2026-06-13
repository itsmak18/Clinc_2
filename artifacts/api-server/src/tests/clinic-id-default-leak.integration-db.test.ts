/**
 * F-P5-1 regression — clinic_id `.default(1)` mislabel on raw inserts (REAL Postgres).
 *
 * Several clinic-bearing tables declare `clinic_id integer NOT NULL DEFAULT 1`
 * (invoice_items, notifications, ...). Service code that inserts into them via the
 * raw `dbUnsafe` client (outside runInTenantContext, so RLS does not enforce) and
 * FORGETS to set clinicId silently gets clinic 1 — correct by accident for the
 * seed clinic, WRONG for every other tenant. The mislabeled rows then vanish on
 * read because the read paths filter `eq(clinicId, req.user.clinicId)`.
 *
 * Two confirmed sites at audit time (Phase 5.1):
 *   - billing.service.createInvoice → invoice_items insert (no clinicId)
 *   - lab/xray/ultrasound update → notifications insert (no clinicId)
 *
 * This test drives the real API as a NON-default clinic (Clinic B, id != 1) and
 * asserts the child rows carry Clinic B's id. Pre-fix: invoice_items / notifications
 * land on clinic 1 and these assertions fail.
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
let invoiceItemsTable: any;
let notificationsTable: any;

const csrf = "f-p5-1-regression-csrf-token";

beforeAll(async () => {
  harness = await startRealDb();
  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);
  ({ invoiceItemsTable, notificationsTable } = await import("@workspace/db"));
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

describe("F-P5-1: raw inserts must carry the caller's clinicId, not DEFAULT 1 (real Postgres)", () => {
  it("createInvoice for Clinic B tags invoice_items with Clinic B's id (not the DEFAULT 1)", async () => {
    expect(seed.clinicB.id).not.toBe(1); // precondition: Clinic B is not the default clinic

    const cookie = await cookieFor(seed.superAdminB, "super_admin");
    const res = await request(app)
      .post("/api/billing/invoices")
      .set("Cookie", writeCookies(cookie))
      .set("X-CSRF-Token", csrf)
      .send({
        patientId: seed.patientB.id,
        items: [{ description: "Consultation", quantity: 2, unitPrice: 50 }],
      });
    expect(res.status).toBe(201);
    const invoiceId = res.body.id as number;

    // Direct DB read (superuser harness, bypasses RLS) — the rows must physically
    // carry Clinic B's id. Pre-fix they'd be 1.
    const items = await harness.db
      .select()
      .from(invoiceItemsTable)
      .where(eq(invoiceItemsTable.invoiceId, invoiceId));
    expect(items.length).toBe(1);
    for (const it of items) {
      expect(it.clinicId, `invoice_items row leaked to clinic ${it.clinicId}`).toBe(seed.clinicB.id);
    }

    // And the clinic-scoped read path must actually return the items for Clinic B.
    const getRes = await request(app)
      .get(`/api/billing/invoices/${invoiceId}`)
      .set("Cookie", [cookie]);
    expect(getRes.status).toBe(200);
    expect(getRes.body.items?.length).toBe(1);
  });

  it("completing a lab test for Clinic B tags the notification with Clinic B's id (not the DEFAULT 1)", async () => {
    const cookie = await cookieFor(seed.superAdminB, "super_admin");

    const createRes = await request(app)
      .post("/api/lab/tests")
      .set("Cookie", writeCookies(cookie))
      .set("X-CSRF-Token", csrf)
      .send({
        patientId: seed.patientB.id,
        requestedById: seed.doctorB.id,
        testName: "CBC",
      });
    expect(createRes.status).toBe(201);
    const testId = createRes.body.id as number;

    const patchRes = await request(app)
      .patch(`/api/lab/tests/${testId}`)
      .set("Cookie", writeCookies(cookie))
      .set("X-CSRF-Token", csrf)
      .send({ status: "completed", results: "Normal" });
    expect(patchRes.status).toBe(200);

    // The "Lab Results Ready" notification fans out to the requesting doctor.
    const notifs = await harness.db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, seed.doctorB.id));
    expect(notifs.length).toBeGreaterThanOrEqual(1);
    for (const n of notifs) {
      expect(n.clinicId, `notification leaked to clinic ${n.clinicId}`).toBe(seed.clinicB.id);
    }
  });
});
