/**
 * Week-day order for schedule UI — index 0 is the week start, matching
 * getWeekStart's Sunday-first convention. Change both together.
 */
export const WEEK_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
export type DayOfWeek = typeof WEEK_DAYS[number];

/** Returns "YYYY-MM-DD" for the Sunday of the week containing `date`. */
export function getWeekStart(date: Date): string {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return toDateStr(d);
}

/** Adds `n` days to a "YYYY-MM-DD" string and returns a new "YYYY-MM-DD" string. */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
