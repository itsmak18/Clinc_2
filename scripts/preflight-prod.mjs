#!/usr/bin/env node
/**
 * preflight-prod.mjs
 *
 * Go-live preflight for docker-compose.prod.yml (AUD-OPS-05, 2026-07-02
 * engineering audit). `docker compose config` and CI cannot catch this class
 * of gap: Prometheus does NOT env-expand its config file (see F-P6-7 /
 * monitoring/prometheus/prometheus.yml), so the blackbox-tls scrape target is
 * a hand-edited literal, not a variable. A CI grep guard would just fail on
 * the legitimately-committed placeholder — this is a deploy-time check, run
 * once by an operator before the first `docker compose up` against a real
 * domain, not a CI gate.
 *
 * Without this check, `EdgeProbeDown` and `SSLCertificateExpiringSoon` are
 * silently inert on a fresh deploy (no real scrape target) until an operator
 * remembers to hand-edit the placeholder — see prometheus-alerts.yml's own
 * comment on the blackbox job.
 *
 * Usage:
 *   node scripts/preflight-prod.mjs
 *
 * Exit codes:
 *   0 — all checks passed, safe to proceed with `docker compose up`
 *   1 — at least one check failed; see printed reason(s)
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

/** Each check returns null on pass, or a human-readable failure reason. */
const CHECKS = [
  function blackboxTlsTargetConfigured() {
    const file = resolve(REPO_ROOT, "monitoring/prometheus/prometheus.yml");
    const content = readFileSync(file, "utf8");
    if (content.includes("clinic.yourdomain.local")) {
      return (
        "monitoring/prometheus/prometheus.yml still targets the placeholder " +
        "'https://clinic.yourdomain.local' for the blackbox-tls scrape job. " +
        "Prometheus does not env-expand this file, so EdgeProbeDown and " +
        "SSLCertificateExpiringSoon have no real target and will never fire " +
        "until you replace it with your actual edge URL."
      );
    }
    return null;
  },
];

function main() {
  const failures = [];
  for (const check of CHECKS) {
    let reason;
    try {
      reason = check();
    } catch (err) {
      reason = `check '${check.name}' threw: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (reason) failures.push(reason);
  }

  if (failures.length > 0) {
    console.error(`[preflight] FAILED — ${failures.length} issue(s) found:\n`);
    for (const f of failures) console.error(`  - ${f}\n`);
    console.error("[preflight] Fix the above before running `docker compose -f docker-compose.prod.yml up`.");
    process.exit(1);
  }

  console.log(`[preflight] All ${CHECKS.length} check(s) passed. Safe to proceed with docker compose up.`);
  process.exit(0);
}

main();
