/**
 * Per-request tenant context for Row Level Security.
 *
 * Migration 0015 enabled RLS on every clinic-bearing table with a policy that
 * is DORMANT unless the session GUC `app.rls_enforce` is set to `'on'`. This
 * helper opens a transaction, sets the GUC and the tenant identifiers, then
 * hands a Drizzle transactional client to the caller. While the caller runs
 * inside `fn`, the DB enforces tenant isolation regardless of whether the
 * caller's queries include `eq(table.clinicId, ...)`.
 *
 * Phase 2.1 rollout strategy: services convert one at a time, e.g.
 *
 *   // before
 *   const rows = await db.select().from(patientsTable).where(eq(...clinicId));
 *
 *   // after
 *   const rows = await runInTenantContext(req.user!, (tx) =>
 *     tx.select().from(patientsTable).where(eq(...))  // clinic filter optional
 *   );
 *
 * The two layers coexist: the existing `eq(t.clinicId, req.user!.clinicId)`
 * filters remain belt-and-braces until the full conversion is complete, at
 * which point they become removable in a separate cleanup PR.
 *
 * Important: this helper REQUIRES `req.user!.clinicId` to be a positive
 * integer. The policy kernel fail-closes on tokens without it (since 2026-05-30),
 * so a routine call site cannot pass an invalid clinicId without already
 * having been rejected at the auth gate.
 */
import { sql } from "drizzle-orm";
import { db } from "./index";

export interface TenantUser {
  userId: number;
  clinicId: number;
  role: string;
}

/**
 * Run `fn` inside a transaction that has `app.rls_enforce='on'`, `app.clinic_id`,
 * `app.user_id`, and `app.role` set as session-local GUCs. All queries made via
 * the supplied `tx` client are tenant-scoped by Postgres itself.
 *
 * The transaction commits when `fn` resolves and rolls back if `fn` throws —
 * Drizzle's default `transaction()` semantics.
 */
export interface TenantContextOptions {
  /**
   * Patient IDs the acting doctor currently has an ACTIVE, audited break-glass
   * session for. When set, `app.break_glass_patient_ids` is populated so the
   * `doctor_scope` RLS policy (migration 0017 + 0024) permits READ of those
   * patients' rows in the five doctor-bound clinical tables — the DB-layer half
   * of the break-glass emergency-access control (audit finding F-P2-1).
   *
   * Only meaningful when `user.role === 'doctor'`; for any other role the
   * doctor_scope policy is already bypassed by the role clause. Caller is
   * responsible for proving the sessions are live (see break-glass.service).
   */
  breakGlassPatientIds?: number[];
}

export async function runInTenantContext<T>(
  user: TenantUser,
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
  options?: TenantContextOptions,
): Promise<T> {
  if (!Number.isInteger(user.clinicId) || user.clinicId <= 0) {
    // Defense in depth — the kernel rejects this case at auth time, but if
    // some future code path bypasses auth (e.g. an internal cron job that
    // forgot to construct a service user), failing closed here is safer than
    // running with an unset GUC (which would either error in the cast or land
    // queries against clinic 0 / NULL).
    throw new Error(`runInTenantContext: invalid clinicId ${user.clinicId}`);
  }
  if (!Number.isInteger(user.userId) || user.userId < 0) {
    throw new Error(`runInTenantContext: invalid userId ${user.userId}`);
  }
  if (typeof user.role !== "string" || user.role.length === 0) {
    throw new Error(`runInTenantContext: invalid role`);
  }

  return db.transaction(async (tx) => {
    // SET LOCAL scopes the GUC to this transaction only — when COMMIT/ROLLBACK
    // runs, the session reverts. Pool checkout/return therefore can't leak
    // tenant state to another request that gets the same connection.
    // Values are bound as parameters via Drizzle's tagged `sql` template
    // (NOT sql.raw) — they come from a verified JWT, not user input, and are
    // passed through Postgres's `set_config(name, value, true)` form (the
    // function-call equivalent of SET LOCAL), which accepts bind parameters;
    // there is no string interpolation, so the SQL-injection surface is zero.
    await tx.execute(sql`SELECT set_config('app.rls_enforce', 'on', true)`);
    await tx.execute(sql`SELECT set_config('app.clinic_id', ${String(user.clinicId)}, true)`);
    await tx.execute(sql`SELECT set_config('app.user_id', ${String(user.userId)}, true)`);
    await tx.execute(sql`SELECT set_config('app.role', ${user.role}, true)`);
    // Break-glass read bypass for doctor_scope RLS (0024). We sanitize to
    // positive integers and join with commas; the policy parses this back via
    // string_to_array(...)::int[]. Empty/absent → GUC left unset → policy
    // enforces normal doctor scope (no bypass).
    const bgIds = options?.breakGlassPatientIds
      ?.filter((n) => Number.isInteger(n) && n > 0);
    if (bgIds && bgIds.length > 0) {
      await tx.execute(sql`SELECT set_config('app.break_glass_patient_ids', ${bgIds.join(",")}, true)`);
    }
    return fn(tx);
  });
}
