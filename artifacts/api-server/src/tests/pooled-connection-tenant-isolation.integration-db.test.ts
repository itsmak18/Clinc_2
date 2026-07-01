/**
 * AUD-DB-05 (engineering audit, 2026-07-01) — pooled-connection cross-tenant
 * isolation, proven empirically rather than assumed from code inspection.
 *
 * `runInTenantContext` (lib/db/src/tenant-context.ts) sets tenant GUCs via
 * `SET LOCAL` inside a real transaction. Points (a)-(d) of AUD-DB-PGB were
 * verified by reading the code: real BEGIN…COMMIT, SET LOCAL not session SET,
 * RLS fails closed on a missing GUC, PgBouncer's DISCARD ALL resets the
 * session. What code-reading cannot close is the end-to-end negative case: a
 * connection that just served tenant A, handed back to the pool and reused by
 * tenant B, must return ZERO rows of tenant A's data — never A's rows leaking
 * into B's query.
 *
 * This file forces that exact scenario without needing a live PgBouncer:
 *   - DB_POOL_MAX=1 is set before @workspace/db is imported, so the
 *     node-postgres pool has exactly one physical connection. Two SEQUENTIAL
 *     runInTenantContext calls are therefore guaranteed to share it — which is
 *     the same hazard PgBouncer transaction-pooling introduces (many logical
 *     sessions sharing one physical backend), just forced deterministically
 *     instead of relying on PgBouncer's scheduling.
 *   - Each tenant context captures `pg_backend_pid()` so the test PROVES the
 *     same physical connection served both tenants, rather than assuming
 *     max:1 achieved that (an assumption bug here would silently turn this
 *     into a no-op test — the pid guard makes that impossible).
 *   - A second scenario forces tenant A's transaction to throw mid-flight
 *     (after SET LOCAL, before COMMIT) and asserts the ROLLBACK leaves the
 *     single shared connection clean for tenant B — this is the concrete
 *     mechanism (not PgBouncer itself) that could actually leak tenant state
 *     across a reused connection if `db.transaction()`'s rollback semantics
 *     were ever wrong.
 *
 * Result of this file is either PASS (AUD-DB-05 becomes PROVEN, not just
 * "consistent-with-fine on inspection") or a failing test that has found a
 * real cross-tenant leak — there is no third outcome.
 *
 * Gated to `pnpm test:integration-db`. Requires Docker OR a local Postgres via
 * INTEGRATION_PG_ADMIN_URL (see _helpers/realDb.ts).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

import type { RealDbHarness } from "./_helpers/realDb";
import { startRealDb } from "./_helpers/realDb";

let harness: RealDbHarness;
let runInTenantContext: typeof import("@workspace/db").runInTenantContext;
let db: typeof import("@workspace/db").db;
let patientsTable: any;
let clinicsTable: any;

let clinicAId: number;
let clinicBId: number;

beforeAll(async () => {
  harness = await startRealDb();

  // Force the @workspace/db pool to a single physical connection BEFORE the
  // dynamic import constructs it (lib/db/src/index.ts reads DB_POOL_MAX at
  // module load). This is what turns "two sequential tenant contexts" into a
  // guaranteed connection-reuse scenario instead of a merely-likely one.
  process.env.DB_POOL_MAX = "1";

  ({ runInTenantContext, db, patientsTable, clinicsTable } = await import("@workspace/db"));

  const existing = (await db.select({ id: clinicsTable.id }).from(clinicsTable)) as Array<{ id: number }>;
  if (existing.find((r) => r.id === 1)) {
    clinicAId = 1;
  } else {
    const inserted = (await db.insert(clinicsTable).values({ name: "Pool Clinic A" }).returning()) as Array<{ id: number }>;
    clinicAId = inserted[0].id;
  }
  const insertedB = (await db.insert(clinicsTable).values({ name: "Pool Clinic B" }).returning()) as Array<{ id: number }>;
  clinicBId = insertedB[0].id;

  await db.insert(patientsTable).values({
    clinicId: clinicAId, mrn: "MRN-POOL-A", idCardNumber: "ID-POOL-A", fullName: "Pool Patient A",
    dateOfBirth: "1990-01-01", gender: "male", phone: "+1-555-4001",
  });
  await db.insert(patientsTable).values({
    clinicId: clinicBId, mrn: "MRN-POOL-B", idCardNumber: "ID-POOL-B", fullName: "Pool Patient B",
    dateOfBirth: "1991-02-02", gender: "female", phone: "+1-555-4002",
  });
}, 180_000);

afterAll(async () => {
  if (harness) await harness.stop();
  delete process.env.DB_POOL_MAX;
});

describe("AUD-DB-05 — pooled-connection cross-tenant isolation (forced connection reuse)", () => {
  it("[GUARD] two sequential tenant contexts actually share the same physical connection", async () => {
    const pidA = await runInTenantContext(
      { userId: 1, clinicId: clinicAId, role: "doctor" },
      async (tx) => (await tx.execute<{ pid: number }>(
        sql`SELECT pg_backend_pid() as pid`,
      )).rows[0].pid,
    );
    const pidB = await runInTenantContext(
      { userId: 2, clinicId: clinicBId, role: "doctor" },
      async (tx) => (await tx.execute<{ pid: number }>(
        sql`SELECT pg_backend_pid() as pid`,
      )).rows[0].pid,
    );
    expect(
      pidA,
      "DB_POOL_MAX=1 did not force connection reuse — this test's premise (two tenants sharing one physical connection) did not hold, so the isolation assertions below would not actually stress the PgBouncer-equivalent hazard. Investigate the pool config before trusting the rest of this file.",
    ).toBe(pidB);
  });

  it("tenant B, immediately after tenant A on the SAME reused connection, sees ONLY its own rows", async () => {
    const rowsA = await runInTenantContext(
      { userId: 1, clinicId: clinicAId, role: "doctor" },
      async (tx) => tx.select().from(patientsTable),
    );
    expect(rowsA.length).toBeGreaterThan(0);
    for (const row of rowsA as any[]) expect(row.clinicId).toBe(clinicAId);

    // No fresh connection is created here — DB_POOL_MAX=1 guarantees this call
    // reuses the exact connection tenant A's transaction just released.
    const rowsB = await runInTenantContext(
      { userId: 2, clinicId: clinicBId, role: "doctor" },
      async (tx) => tx.select().from(patientsTable),
    );
    expect(rowsB.length).toBeGreaterThan(0);
    for (const row of rowsB as any[]) {
      expect(
        row.clinicId,
        `tenant B's query on a connection just used by tenant A returned a clinic ${row.clinicId} row — cross-tenant leak under connection reuse`,
      ).toBe(clinicBId);
    }
    expect((rowsB as any[]).find((r) => r.clinicId === clinicAId)).toBeUndefined();
  });

  it("a mid-transaction throw for tenant A does not poison the shared connection for tenant B", async () => {
    // Tenant A's callback runs SET LOCAL (via runInTenantContext) and then
    // throws before doing anything else. db.transaction()'s rollback must run
    // for real, and the connection must come back to the pool clean — not
    // holding an aborted-transaction state or a leftover tenant-A GUC.
    await expect(
      runInTenantContext(
        { userId: 1, clinicId: clinicAId, role: "doctor" },
        async () => {
          throw new Error("[test] simulated mid-transaction failure for tenant A");
        },
      ),
    ).rejects.toThrow(/simulated mid-transaction failure/);

    // Tenant B immediately reuses the same (only) pooled connection. If the
    // rollback above left the connection in a bad state, this either throws
    // (broken transaction) or, worse, silently returns tenant A's rows.
    const rowsB = await runInTenantContext(
      { userId: 2, clinicId: clinicBId, role: "doctor" },
      async (tx) => tx.select().from(patientsTable),
    );
    expect(rowsB.length).toBeGreaterThan(0);
    for (const row of rowsB as any[]) {
      expect(
        row.clinicId,
        "tenant B saw another clinic's row after tenant A's transaction was rolled back on the shared connection",
      ).toBe(clinicBId);
    }
  });
});
