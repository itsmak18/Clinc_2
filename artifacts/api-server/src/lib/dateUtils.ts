import { toZonedTime, fromZonedTime, formatInTimeZone } from "date-fns-tz";
import type { AuthRequest } from "../middlewares/auth";
import { config } from "./config";

const DEFAULT_TZ = config.clinicTz;

/**
 * Resolve effective timezone for a request: per-clinic from JWT claim if
 * populated, otherwise env default. The mint path will start populating
 * `req.user.timezone` from the clinics table — until then this falls back
 * cleanly so existing callsites keep working.
 */
export function getClinicTimezone(req?: AuthRequest): string {
  return req?.user?.timezone ?? DEFAULT_TZ;
}

function zonedStartOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function zonedEndOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}

/**
 * Start/end of "today" in clinic timezone. Pass `tz` (or `req`) to use a
 * per-clinic zone; omit for env default.
 */
export function todayBoundary(tz: string = DEFAULT_TZ): { start: Date; end: Date } {
  const now = new Date();
  const zoned = toZonedTime(now, tz);
  return {
    start: fromZonedTime(zonedStartOfDay(zoned), tz),
    end:   fromZonedTime(zonedEndOfDay(zoned),   tz),
  };
}

/**
 * Today's date as `yyyy-MM-dd` in clinic timezone (NOT UTC). Use this for any
 * "default to today" date string so the day window matches the clinic's
 * business day rather than the UTC calendar day.
 */
export function clinicDateString(tz: string = DEFAULT_TZ): string {
  return formatInTimeZone(new Date(), tz, "yyyy-MM-dd");
}

/**
 * Start/end of `dateStr` (ISO yyyy-mm-dd) in clinic timezone.
 */
export function dayBoundary(dateStr: string, tz: string = DEFAULT_TZ): { start: Date; end: Date } {
  const d = new Date(dateStr);
  const zoned = toZonedTime(d, tz);
  return {
    start: fromZonedTime(zonedStartOfDay(zoned), tz),
    end:   fromZonedTime(zonedEndOfDay(zoned),   tz),
  };
}
