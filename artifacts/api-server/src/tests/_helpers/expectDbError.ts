import { expect } from "vitest";

/**
 * Assert a DB operation is rejected by Postgres with an error matching `pattern`.
 *
 * Why this exists: drizzle-orm (node-postgres driver) wraps query failures as
 * `Error("Failed query: <sql>")` and puts the actual Postgres error — the one
 * whose text is "new row violates row-level security policy" / "violates check
 * constraint …" / "permission denied …" — on `error.cause`. Vitest's
 * `.rejects.toThrow(/re/)` only matches against `error.message` ("Failed query:
 * …"), so it never sees the real reason. This helper matches across both
 * `message` and `cause` so the integration tests actually validate the DB
 * behavior they intend to.
 */
export async function expectDbReject(op: Promise<unknown>, pattern: RegExp): Promise<void> {
  const err: unknown = await Promise.resolve(op).then(() => null, (e) => e);
  expect(err, "expected the operation to be rejected by the database").toBeTruthy();
  const e = err as { message?: string; cause?: unknown };
  const text = [
    e?.message,
    (e?.cause as { message?: string } | undefined)?.message,
    e?.cause != null ? String(e.cause) : undefined,
  ]
    .filter(Boolean)
    .join(" | ");
  expect(text, `rejection did not match ${pattern}`).toMatch(pattern);
}
