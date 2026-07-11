/**
 * Vitals doctor-scope + tenant isolation — REAL Postgres.
 *
 * Closes audit finding F-H2. appointment-lifecycle.integration-db.test.ts already
 * covers createVitals (consent-free creation, auto-advance, strict schema guard),
 * so this file pins the ACCESS-CONTROL dimension that test omits:
 *
 *   1. listVitals is doctor-scoped: a doctor linked to the patient sees the row;
 *      a same-clinic doctor with no assignment sees nothing.
 *   2. A non-doctor clinical role (nurse) sees the clinic's vitals.
 *   3. Cross-tenant: a clinic-B reader never sees clinic-A vitals.
 *
 * Service-layer calls with a minimal `{ user, headers, ip }` request, mirroring
 * appointment-lifecycle.integration-db.test.ts.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker (or INTEGRATION_PG_ADMIN_URL).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";
import type { CrossTenantSeed } from "./_helpers/seedCrossTenant";

let harness: RealDbHarness;
let seed: CrossTenantSeed;

let createVitals: any;
let listVitals: any;

let drLinked: { id: number };
let drUnlinked: { id: number };
let createdVitalsId: string;

const reqOf = (user: object) => ({ user, headers: {}, ip: "127.0.0.1" } as any);

beforeAll(async () => {
  harness = await startRealDb();

  const { seedCrossTenant } = await import("./_helpers/seedCrossTenant");
  seed = await seedCrossTenant(harness.db);

  const db = (await import("@workspace/db")) as any;
  const { usersTable, doctorPatientsTable } = db;
  const { hashPassword } = await import("../lib/password");
  ({ createVitals, listVitals } = await import("../modules/clinical/vitals.service"));
  await import("../app"); // ensure runtime (audit outbox, metrics) is wired

  const pw = await hashPassword("test_password_123!");
  const [a1] = (await harness.db.insert(usersTable).values({
    username: "vit_dr_linked", fullName: "Vit Dr Linked", passwordHash: pw, role: "doctor", clinicId: seed.clinicA.id,
  }).returning()) as any[];
  const [a2] = (await harness.db.insert(usersTable).values({
    username: "vit_dr_unlinked", fullName: "Vit Dr Unlinked", passwordHash: pw, role: "doctor", clinicId: seed.clinicA.id,
  }).returning()) as any[];
  drLinked = a1;
  drUnlinked = a2;

  await harness.db.insert(doctorPatientsTable).values({
    clinicId: seed.clinicA.id, doctorId: a1.id, patientId: seed.patientA.id, lastSeenAt: new Date(),
  }).onConflictDoNothing();

  // Nurse records vitals for patientA (no appointment → auto-advance is a no-op).
  const nurseA = reqOf({ userId: seed.superAdminA.id, username: "nurse_a", role: "nurse", clinicId: seed.clinicA.id });
  const row = await createVitals(nurseA, {
    patientId: seed.patientA.id,
    vitals: { bloodPressureSystolic: 120, bloodPressureDiastolic: 80, heartRate: 72 },
  });
  createdVitalsId = row.id;
}, 120_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

describe("listVitals doctor scope", () => {
  it("a doctor linked to the patient sees the vitals row", async () => {
    const req = reqOf({ userId: drLinked.id, username: "dl", role: "doctor", clinicId: seed.clinicA.id });
    const rows = await listVitals(req, {});
    expect(rows.some((r: any) => r.id === createdVitalsId)).toBe(true);
  });

  it("a same-clinic doctor with no assignment sees nothing", async () => {
    const req = reqOf({ userId: drUnlinked.id, username: "du", role: "doctor", clinicId: seed.clinicA.id });
    const rows = await listVitals(req, {});
    expect(rows.length).toBe(0);
  });
});

describe("listVitals tenant isolation", () => {
  it("a clinic-A nurse sees the clinic's vitals", async () => {
    const req = reqOf({ userId: seed.superAdminA.id, username: "nurse_a", role: "nurse", clinicId: seed.clinicA.id });
    const rows = await listVitals(req, {});
    expect(rows.some((r: any) => r.id === createdVitalsId)).toBe(true);
  });

  it("a clinic-B nurse never sees clinic-A vitals", async () => {
    const req = reqOf({ userId: seed.superAdminB.id, username: "nurse_b", role: "nurse", clinicId: seed.clinicB.id });
    const rows = await listVitals(req, {});
    expect(rows.some((r: any) => r.id === createdVitalsId)).toBe(false);
  });
});
