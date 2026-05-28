// Phase 2 — persistence for /api/csp-report. Route layer parses the body
// (legacy `csp-report` or Reporting API), this service inserts. Failures are
// swallowed (the browser doesn't care; we don't want a CSP-report endpoint
// to ever 5xx).

import { db, cspReportsTable } from "@workspace/db";
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

export async function persistCspReport(inp: CspReportInput): Promise<void> {
  try {
    await db.insert(cspReportsTable).values(inp);
  } catch (err) {
    logger.warn({ err }, "csp_report_insert_failed");
  }
}
