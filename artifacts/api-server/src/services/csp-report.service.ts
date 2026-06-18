// Phase 2 — persistence for /api/csp-report. Route layer parses the body
// (legacy `csp-report` or Reporting API), this service inserts. Failures are
// swallowed (the browser doesn't care; we don't want a CSP-report endpoint
// to ever 5xx).

// dbUnsafe: csp_reports has no clinicId column — CSP reports are browser-level
// events with no tenant context (they arrive pre-auth on a public endpoint).
import { dbUnsafe as db, cspReportsTable } from "@workspace/db";
import { logger } from "../lib/logger";

export interface CspReportInput {
  documentUri: string | null;
  referrer: string | null;
  violatedDirective: string | null;
  effectiveDirective: string | null;
  originalPolicy: string | null;
  disposition: string | null;
  blockedUri: string | null;
  statusCode: number | null;
  sourceFile: string | null;
  lineNumber: number | null;
  columnNumber: number | null;
  scriptSample: string | null;
  raw: Record<string, unknown>;
  userAgent: string | null;
  ipAddress: string | null;
}

// Bounds for an anonymous, unauthenticated endpoint: a hostile client could POST
// oversized fields to bloat the table. The 1mb body cap + global rate limiter are
// the outer guard; these clamps keep individual rows sane. URLs/policies can be
// long but not unbounded; the raw blob is the largest risk (whole report object).
const MAX_FIELD = 2048;
const MAX_SAMPLE = 4096;
const MAX_RAW_BYTES = 16 * 1024;

function clamp(v: string | null, max: number): string | null {
  return v == null ? v : v.length > max ? v.slice(0, max) : v;
}

export async function persistCspReport(inp: CspReportInput): Promise<void> {
  try {
    // Cap the raw JSONB by serialized size — replace with a marker if oversized
    // rather than persisting an attacker-controlled megabyte of nested JSON.
    let raw: Record<string, unknown> = inp.raw;
    try {
      const serialized = JSON.stringify(inp.raw ?? {});
      if (serialized.length > MAX_RAW_BYTES) {
        raw = { _truncated: true, _bytes: serialized.length };
      }
    } catch {
      raw = { _unserializable: true };
    }

    await db.insert(cspReportsTable).values({
      ...inp,
      documentUri: clamp(inp.documentUri, MAX_FIELD),
      referrer: clamp(inp.referrer, MAX_FIELD),
      violatedDirective: clamp(inp.violatedDirective, MAX_FIELD),
      effectiveDirective: clamp(inp.effectiveDirective, MAX_FIELD),
      originalPolicy: clamp(inp.originalPolicy, MAX_FIELD),
      disposition: clamp(inp.disposition, MAX_FIELD),
      blockedUri: clamp(inp.blockedUri, MAX_FIELD),
      sourceFile: clamp(inp.sourceFile, MAX_FIELD),
      scriptSample: clamp(inp.scriptSample, MAX_SAMPLE),
      userAgent: clamp(inp.userAgent, MAX_FIELD),
      ipAddress: clamp(inp.ipAddress, MAX_FIELD),
      raw,
    });
  } catch (err) {
    logger.warn({ err }, "csp_report_insert_failed");
  }
}
