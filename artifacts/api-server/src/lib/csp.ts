// Single source of truth for the Content Security Policy.
// Imported by app.ts (helmet) and tested by csp.test.ts.
// The Vite dev-server plugin in vite.config.ts duplicates the string form —
// keep them in sync when editing this file.

import { isCspReportEnabled } from "./auth-constants";

export const CSP_REPORT_PATH = "/api/csp-report";

export function cspReportUri(): string | null {
  return isCspReportEnabled() ? CSP_REPORT_PATH : null;
}

export const cspDirectives: Record<string, string[]> = {
  defaultSrc:     ["'self'"],
  scriptSrc:      ["'self'"],
  // unsafe-inline retained: React style={} props + chart.tsx dangerouslySetInnerHTML
  styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  fontSrc:        ["'self'", "https://fonts.gstatic.com", "data:"],
  imgSrc:         ["'self'", "data:", "https:"],
  connectSrc:     ["'self'"],
  // frame-ancestors is header-only — not valid inside a <meta> CSP tag
  frameAncestors: ["'none'"],
  objectSrc:      ["'none'"],
  baseUri:        ["'self'"],
  formAction:     ["'self'"],
};

function toKebab(key: string): string {
  return key.replace(/([A-Z])/g, (_, c: string) => `-${c.toLowerCase()}`);
}

export function buildCspString(exclude: string[] = []): string {
  const skip = new Set(exclude);
  const reportUri = cspReportUri();
  const base = Object.entries(cspDirectives)
    .filter(([key]) => !skip.has(key))
    .map(([key, values]) => `${toKebab(key)} ${values.join(" ")}`)
    .join("; ");
  return reportUri ? `${base}; report-uri ${reportUri}` : base;
}

// Pre-built string suitable for <meta http-equiv="Content-Security-Policy">
// (frame-ancestors is excluded — browsers ignore it in meta tags)
export const cspMetaString = buildCspString(["frameAncestors"]);
