// Phase 2 — CSP violation ingestion.
//
// Browsers POST application/csp-report (legacy) or application/reports+json
// (Reporting API). We accept either, persist the normalized fields, and
// stuff the raw payload into `raw` for forensics. No auth — anyone in the
// browser context can hit this.

import { Router } from "express";
import { asyncHandler } from "../middlewares/asyncHandler";
import { isCspReportEnabled } from "../lib/auth-constants";
import { CSP_REPORT_PATH } from "../lib/csp";
import { persistCspReport } from "../services/csp-report.service";

const router = Router();

interface LegacyCspBody {
  "csp-report"?: Record<string, unknown>;
}

router.post(
  "/api/csp-report",
  asyncHandler(async (req, res) => {
    if (!isCspReportEnabled()) {
      res.status(204).end();
      return;
    }

    const body = req.body as LegacyCspBody | Record<string, unknown> | unknown;

    let report: Record<string, unknown> = {};
    if (
      body &&
      typeof body === "object" &&
      "csp-report" in (body as LegacyCspBody) &&
      (body as LegacyCspBody)["csp-report"]
    ) {
      report = (body as LegacyCspBody)["csp-report"]!;
    } else if (Array.isArray(body)) {
      // Reporting API: array of report objects with `body` member.
      const first = (body as unknown[])[0] as
        | { body?: Record<string, unknown> }
        | undefined;
      report = first?.body ?? {};
    } else if (body && typeof body === "object") {
      report = body as Record<string, unknown>;
    }

    const get = (k: string): string | null => {
      const v = report[k];
      return typeof v === "string" ? v : null;
    };
    const getInt = (k: string): number | null => {
      const v = report[k];
      return typeof v === "number" ? Math.trunc(v) : null;
    };

    await persistCspReport({
      documentUri: get("document-uri") ?? get("documentURL"),
      referrer: get("referrer"),
      violatedDirective: get("violated-directive") ?? get("violatedDirective"),
      effectiveDirective: get("effective-directive") ?? get("effectiveDirective"),
      originalPolicy: get("original-policy") ?? get("originalPolicy"),
      disposition: get("disposition"),
      blockedUri: get("blocked-uri") ?? get("blockedURL"),
      statusCode: getInt("status-code") ?? getInt("statusCode"),
      sourceFile: get("source-file") ?? get("sourceFile"),
      lineNumber: getInt("line-number") ?? getInt("lineNumber"),
      columnNumber: getInt("column-number") ?? getInt("columnNumber"),
      scriptSample: get("script-sample") ?? get("sample"),
      raw: report,
      userAgent: req.headers["user-agent"] ?? null,
      ipAddress: req.ip ?? null,
    });

    res.status(204).end();
  }),
);

export { CSP_REPORT_PATH };
export default router;
