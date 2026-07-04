/**
 * money.ts — exact money arithmetic in integer minor units (cents).
 *
 * Invoice money is stored as Postgres `numeric(10,2)` (exact), but the service
 * layer historically parsed those values with `parseFloat` and summed them with
 * JS floating point. Storage was exact; the arithmetic was not — aggregating
 * many invoices in `Array.reduce((s,i)=>s+parseFloat(i.total),0)` accumulates
 * binary-float error (the `0.1 + 0.2 = 0.30000000000000004` class), so a daily
 * reconciliation total could drift off the true figure and an exact-equality
 * check (cash-drawer reconciliation) could spuriously mismatch.
 *
 * This module keeps all money math in integer cents. Parse once at the DB/JSON
 * boundary, do every add/subtract/compare in integer cents (which JS represents
 * exactly up to 2^53), and format back to a 2-dp string only for output.
 *
 * Phase C of the audit remediation migrates the storage columns to `*_cents`
 * (bigint) so the parse step disappears; until then this is the single sanctioned
 * place that turns a numeric string into cents.
 */

/**
 * Parse a money value into integer cents — exactly, no `parseFloat`.
 *
 * Accepts a Postgres `numeric` string ("150.00", "0.30", "-12.5", "48210.67")
 * or a JS number (a client-supplied unit price from JSON). For numbers we round
 * `value * 100` — safe for the ≤2-dp inputs we accept because the float error of
 * a single multiply is far below 0.5; the danger is only in accumulation, which
 * this module removes by keeping everything in cents thereafter.
 *
 * @throws if the value is not a finite, well-formed money amount.
 */
export function parseMoneyToCents(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`parseMoneyToCents: not a finite number: ${value}`);
    }
    return Math.round(value * 100);
  }
  const s = value.trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) {
    throw new Error(`parseMoneyToCents: malformed money string: ${JSON.stringify(value)}`);
  }
  const sign = m[1] ? -1 : 1;
  const whole = Number(m[2]);
  const fracRaw = m[3] ?? "";
  const frac2 = fracRaw.slice(0, 2).padEnd(2, "0");
  let cents = whole * 100 + Number(frac2);
  // Guard an unexpected >2-dp fraction (numeric(10,2) never returns one, but a
  // hand-built string might): round half-up on the third digit.
  if (fracRaw.length > 2 && Number(fracRaw[2]) >= 5) {
    cents += 1;
  }
  return sign * cents;
}

/** Sum a list of integer-cent amounts. Exact (no float accumulation). */
export function sumCents(amounts: number[]): number {
  let total = 0;
  for (const c of amounts) total += c;
  return total;
}

/**
 * Format integer cents back into a fixed 2-dp decimal string ("15000" → "150.00",
 * "-5" → "-0.05"). This is the string that goes into a `numeric(10,2)` column.
 */
export function formatCents(cents: number): string {
  const rounded = Math.round(cents);
  const neg = rounded < 0;
  const abs = Math.abs(rounded);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  return `${neg ? "-" : ""}${whole}.${String(frac).padStart(2, "0")}`;
}

/**
 * Convert integer cents to a JS number of major units (dollars) for a response
 * body that is still typed as `number`. The value is exact to the cent; only the
 * final IEEE-754 representation is approximate, which `toFixed(2)` on the client
 * resolves. Prefer returning `formatCents()` where the contract allows a string.
 */
export function centsToNumber(cents: number): number {
  return cents / 100;
}
