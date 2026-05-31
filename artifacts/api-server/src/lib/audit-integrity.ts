import { createHash } from "node:crypto";
import { db, auditLogsTable, auditIntegrityChecksTable } from "@workspace/db";
import { eq, gte, lt, asc, and } from "drizzle-orm";
import { logger } from "./logger";
import { auditIntegrityMismatchTotal } from "./metrics";

type AuditRow = {
  id: number;
  userId: number | null;
  clinicId: number | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  createdAt: Date;
};

/** Deterministic SHA-256 hex over prevHash + rows (caller must sort by id ASC). */
export function computeHashFromRows(rows: AuditRow[], prevHash: string): string {
  const h = createHash("sha256");
  h.update(prevHash);
  for (const r of rows) {
    h.update(
      `\n${r.id}:${r.userId ?? ""}:${r.clinicId ?? ""}:${r.action}:${r.entityType ?? ""}:${r.entityId ?? ""}:${r.createdAt.toISOString()}`,
    );
  }
  return h.digest("hex");
}

async function fetchRowsForDate(dateStr: string): Promise<AuditRow[]> {
  // [00:00:00.000Z, 00:00:00.000Z next day) — exactly one calendar day UTC, no overlap
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return db
    .select({
      id: auditLogsTable.id,
      userId: auditLogsTable.userId,
      clinicId: auditLogsTable.clinicId,
      action: auditLogsTable.action,
      entityType: auditLogsTable.entityType,
      entityId: auditLogsTable.entityId,
      createdAt: auditLogsTable.createdAt,
    })
    .from(auditLogsTable)
    .where(and(gte(auditLogsTable.createdAt, start), lt(auditLogsTable.createdAt, end)))
    .orderBy(asc(auditLogsTable.id));
}

async function getPrevHash(dateStr: string): Promise<string> {
  const prev = new Date(`${dateStr}T00:00:00.000Z`);
  prev.setUTCDate(prev.getUTCDate() - 1);
  const prevDateStr = prev.toISOString().slice(0, 10);

  const [record] = await db
    .select({ rootHash: auditIntegrityChecksTable.rootHash })
    .from(auditIntegrityChecksTable)
    .where(eq(auditIntegrityChecksTable.checkedDate, prevDateStr))
    .limit(1);

  return record?.rootHash ?? "genesis";
}

/**
 * Compute and persist the integrity hash for a given UTC date.
 * Idempotent — a second call for the same date updates the existing row.
 * @param date - defaults to yesterday (UTC) when omitted.
 */
export async function recordDailyIntegrity(date?: Date): Promise<void> {
  const target = date ?? (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d;
  })();
  const dateStr = target.toISOString().slice(0, 10);

  const prevHash = await getPrevHash(dateStr);
  const rows = await fetchRowsForDate(dateStr);
  const rootHash = computeHashFromRows(rows, prevHash);
  const status = rows.length === 0 ? "empty" : "ok";

  await db
    .insert(auditIntegrityChecksTable)
    .values({ checkedDate: dateStr, rowCount: rows.length, rootHash, prevHash, status })
    .onConflictDoUpdate({
      target: auditIntegrityChecksTable.checkedDate,
      set: { rowCount: rows.length, rootHash, prevHash, status, verifiedAt: null },
    });

  logger.info({ date: dateStr, rowCount: rows.length, status }, "audit_integrity_recorded");
}

/**
 * Re-compute the hash for a stored date and compare to the recorded value.
 * Increments the Prometheus mismatch counter and updates `status`/`verifiedAt`
 * when a discrepancy is detected.
 */
export async function verifyIntegrity(
  date: Date,
): Promise<{ ok: boolean; stored: string; computed: string }> {
  const dateStr = date.toISOString().slice(0, 10);

  const [stored] = await db
    .select()
    .from(auditIntegrityChecksTable)
    .where(eq(auditIntegrityChecksTable.checkedDate, dateStr))
    .limit(1);

  if (!stored) {
    throw new Error(`No audit integrity record for ${dateStr} — run recordDailyIntegrity first`);
  }

  // Re-derive using the prevHash that was in effect when the record was created.
  // This keeps the verification self-contained: tampering with rows is what we detect,
  // not drift in the prevHash chain (which is a separate verification concern).
  const rows = await fetchRowsForDate(dateStr);
  const computed = computeHashFromRows(rows, stored.prevHash);
  const ok = stored.rootHash === computed;

  await db
    .update(auditIntegrityChecksTable)
    .set({ verifiedAt: new Date(), status: ok ? stored.status : "mismatch" })
    .where(eq(auditIntegrityChecksTable.checkedDate, dateStr));

  if (!ok) {
    auditIntegrityMismatchTotal.inc();
    logger.error(
      { date: dateStr, stored: stored.rootHash, computed },
      "audit_integrity_mismatch — possible tampering",
    );
  }

  return { ok, stored: stored.rootHash, computed };
}
