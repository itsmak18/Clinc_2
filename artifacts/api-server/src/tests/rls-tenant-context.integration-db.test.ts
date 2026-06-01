/**
 * RLS tenant context — REAL Postgres.
 *
 * Migration 0015 enables RLS on every clinic-bearing table with a dormant-by-
 * default policy. `runInTenantContext(user, fn)` activates the policy inside a
 * transaction by setting `app.rls_enforce='on'` + the tenant GUCs.
 *
 * This test proves both halves of the rollout switch:
 *
 *   1. Outside `runInTenantContext` (dormant): `db.select()` returns rows from
 *      every clinic. RLS is not enforced. This preserves backward compatibility
 *      for service code that has not been migrated yet.
 *
 *   2. Inside `runInTenantContext({clinicId: A, ...}, fn)`: queries via `tx`
 *      return ONLY clinic-A rows, even if the query has no `eq(t.clinicId, ...)`
 *      filter. The DB is enforcing isolation.
 *
 *   3. Inside `runInTenantContext`, an INSERT for the wrong clinic_id is
 *      rejected by the WITH CHECK clause — the DB refuses cross-tenant writes
 *      even if a service forgets to set clinicId on INSERT.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";

let harness: RealDbHarness;
// Dynamically imported AFTER the container starts so @workspace/db sees the
// connection string set by startRealDb().
let runInTenantContext: typeof import("@workspace/db").runInTenantContext;
let db: typeof import("@workspace/db").db;
let patientsTable: any;
let clinicsTable: any;

let clinicAId: number;
let clinicBId: number;

// ── STEP 0 PROBE ─────────────────────────────────────────────────────────────
// Temporary diagnostic: discover whether the integration-db connecting role is
// a superuser. If rolsuper || rolbypassrls is true, the RLS policy is bypassed
// unconditionally and the tenant-isolation tests below prove nothing.
// Run: pnpm --filter @workspace/api-server run test:integration-db
// Remove this block once Phase 1 (medicore_app role) is implemented.
// ─────────────────────────────────────────────────────────────────────────────
describe("STEP-0 PROBE — connecting role identity", () => {
  let probeHarness: RealDbHarness;

  beforeAll(async () => {
    probeHarness = await startRealDb();
  }, 180_000);

  afterAll(async () => {
    if (probeHarness) await probeHarness.stop();
  });

  it("prints current_user, rolsuper, rolbypassrls and row count visibility", async () => {
    const { rows } = await probeHarness.pool.query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT current_user,
              r.rolsuper,
              r.rolbypassrls
       FROM pg_roles r
       WHERE r.rolname = current_user`,
    );
    const role = rows[0];
    console.log("\n━━━ STEP-0 PROBE RESULT ━━━");
    console.log(`  current_user  : ${role.current_user}`);
    console.log(`  rolsuper      : ${role.rolsuper}`);
    console.log(`  rolbypassrls  : ${role.rolbypassrls}`);
    console.log(
      `  RLS enforced? : ${!role.rolsuper && !role.rolbypassrls ? "YES ✅ (non-superuser)" : "NO ❌ (superuser/bypassrls — RLS is inert)"}`,
    );
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // This assertion is the guard we want permanently. For now it documents the
    // finding: if it FAILS, the connecting role is a superuser and the tenant-
    // isolation tests below prove nothing in prod terms.
    expect(
      role.rolsuper || role.rolbypassrls,
      `Connecting role '${role.current_user}' is a superuser or has BYPASSRLS. ` +
        `RLS is unconditionally bypassed — the isolation tests below do NOT prove prod safety. ` +
        `Phase 1 (medicore_app role) must be completed before this guard passes.`,
    ).toBe(false);
  });
});
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  harness = await startRealDb();

  ({ runInTenantContext, db, patientsTable, clinicsTable } = await import("@workspace/db"));

  // Two clinics. Migration 0000 may have seeded id=1 — handle both cases.
  const existing = (await db.select({ id: clinicsTable.id }).from(clinicsTable)) as Array<{ id: number }>;
  if (existing.find((r) => r.id === 1)) {
    clinicAId = 1;
  } else {
    const inserted = (await db.insert(clinicsTable).values({ name: "RLS Clinic A" }).returning()) as Array<{ id: number }>;
    clinicAId = inserted[0].id;
  }
  const insertedB = (await db.insert(clinicsTable).values({ name: "RLS Clinic B" }).returning()) as Array<{ id: number }>;
  clinicBId = insertedB[0].id;

  // One patient per clinic. These INSERTs happen with RLS dormant (no tenant
  // context), so both succeed regardless of clinic.
  await db.insert(patientsTable).values({
    clinicId: clinicAId, mrn: "MRN-RLS-A", fullName: "RLS Patient A",
    dateOfBirth: "1990-01-01", gender: "male", phone: "+1-555-2001",
  });
  await db.insert(patientsTable).values({
    clinicId: clinicBId, mrn: "MRN-RLS-B", fullName: "RLS Patient B",
    dateOfBirth: "1991-02-02", gender: "female", phone: "+1-555-2002",
  });
}, 180_000);

afterAll(async () => {
  if (harness) await harness.stop();
});

describe("Row Level Security — dormant-by-default", () => {
  it("queries OUTSIDE runInTenantContext see rows from every clinic (RLS dormant)", async () => {
    const rows = (await db.select().from(patientsTable)) as Array<{ clinicId: number }>;
    const clinicIds = new Set(rows.map((r) => r.clinicId));
    expect(clinicIds.has(clinicAId)).toBe(true);
    expect(clinicIds.has(clinicBId)).toBe(true);
  });
});

describe("Row Level Security — active inside runInTenantContext", () => {
  it("queries INSIDE runInTenantContext for clinic A see ONLY clinic A rows", async () => {
    const rows = await runInTenantContext(
      { userId: 1, clinicId: clinicAId, role: "doctor" },
      async (tx) => tx.select().from(patientsTable),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows as any[]) {
      expect(
        row.clinicId,
        `tenant context for clinic ${clinicAId} returned a row from clinic ${row.clinicId}`,
      ).toBe(clinicAId);
    }
  });

  it("[symmetry] queries INSIDE runInTenantContext for clinic B see ONLY clinic B rows", async () => {
    const rows = await runInTenantContext(
      { userId: 2, clinicId: clinicBId, role: "doctor" },
      async (tx) => tx.select().from(patientsTable),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows as any[]) {
      expect(row.clinicId).toBe(clinicBId);
    }
  });

  it("a forgotten WHERE clause inside tenant context still returns zero cross-tenant rows", async () => {
    // This simulates the exact regression that motivated RLS: a service that
    // does `db.select().from(t)` without the `eq(t.clinicId, …)` filter. RLS
    // means the missing filter is harmless inside a tenant context.
    const rows = await runInTenantContext(
      { userId: 1, clinicId: clinicAId, role: "super_admin" },
      async (tx) => tx.select().from(patientsTable),
    );
    expect(rows.find((r: any) => r.clinicId === clinicBId)).toBeUndefined();
  });

  it("INSERT for the wrong clinic_id is rejected by the WITH CHECK clause", async () => {
    // Inside a clinic-A tenant context, trying to write a row tagged as
    // clinic B must be refused by the DB.
    await expect(
      runInTenantContext(
        { userId: 1, clinicId: clinicAId, role: "super_admin" },
        async (tx) => tx.insert(patientsTable).values({
          clinicId: clinicBId, mrn: "MRN-RLS-CROSS", fullName: "Cross Write",
          dateOfBirth: "1990-01-01", gender: "male", phone: "+1-555-3000",
        }),
      ),
    ).rejects.toThrow(/row-level security|new row violates/i);
  });

  it("invalid clinicId throws before opening the transaction", async () => {
    await expect(
      runInTenantContext({ userId: 1, clinicId: 0, role: "doctor" }, async () => null),
    ).rejects.toThrow(/invalid clinicId/i);
    await expect(
      runInTenantContext({ userId: 1, clinicId: -1, role: "doctor" }, async () => null),
    ).rejects.toThrow(/invalid clinicId/i);
  });
});
