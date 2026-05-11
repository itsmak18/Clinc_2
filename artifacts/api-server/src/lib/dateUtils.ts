import { toZonedTime, fromZonedTime } from "date-fns-tz";

/**
 * Timezone-aware day boundary helpers (L-03).
 * Uses CLINIC_TZ env var (default: Europe/Istanbul UTC+3) so "today"
 * matches the clinic's local calendar, not UTC midnight.
 */
const CLINIC_TZ = process.env.CLINIC_TZ ?? "Europe/Istanbul";

/** Truncate a zoned Date to start of day (midnight 00:00:00.000) */
function zonedStartOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Set a zoned Date to end of day (23:59:59.999) */
function zonedEndOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

/**
 * Returns the start and end of the current day in clinic timezone as UTC Date objects.
 */
export function todayBoundary(): { start: Date; end: Date } {
  const now = new Date();
  const zoned = toZonedTime(now, CLINIC_TZ);
  return {
    start: fromZonedTime(zonedStartOfDay(zoned), CLINIC_TZ),
    end:   fromZonedTime(zonedEndOfDay(zoned),   CLINIC_TZ),
  };
}

/**
 * Returns the start and end of the given date string in clinic timezone as UTC Date objects.
 * @param dateStr ISO date string e.g. "2026-05-11"
 */
export function dayBoundary(dateStr: string): { start: Date; end: Date } {
  const d = new Date(dateStr);
  const zoned = toZonedTime(d, CLINIC_TZ);
  return {
    start: fromZonedTime(zonedStartOfDay(zoned), CLINIC_TZ),
    end:   fromZonedTime(zonedEndOfDay(zoned),   CLINIC_TZ),
  };
}
