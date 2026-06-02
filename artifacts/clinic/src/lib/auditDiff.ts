// Field-level before→after diff for audit log change-history.
// Pure, dependency-free — fed by audit_logs.beforeState / afterState JSONB.

export type DiffStatus = "added" | "removed" | "changed";
export interface DiffRow {
  key: string;
  before: unknown;
  after: unknown;
  status: DiffStatus;
}

type Obj = Record<string, unknown>;

function isPlainObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Compute the set of fields that differ between two state snapshots.
 * - `before == null` → treat as creation (all `after` keys are "added").
 * - `after == null`  → treat as deletion (all `before` keys are "removed").
 * Equality is by stable JSON serialization, so nested objects/arrays compare by value.
 */
export function computeDiff(before: unknown, after: unknown): DiffRow[] {
  const b: Obj = isPlainObject(before) ? before : {};
  const a: Obj = isPlainObject(after) ? after : {};
  const keys = Array.from(new Set([...Object.keys(b), ...Object.keys(a)])).sort();

  const rows: DiffRow[] = [];
  for (const key of keys) {
    const bv = b[key];
    const av = a[key];
    if (stableEqual(bv, av)) continue;
    const inB = key in b;
    const inA = key in a;
    const status: DiffStatus = !inB ? "added" : !inA ? "removed" : "changed";
    rows.push({ key, before: bv, after: av, status });
  }
  return rows;
}

function stableEqual(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  try {
    return JSON.stringify(x) === JSON.stringify(y);
  } catch {
    return false;
  }
}

/** Human-readable rendering of a single field value for the diff table. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v.length ? v : '""';
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}
