# Security Architecture

> Operative security details (auth layers, CSRF, rate limiting, audit, CSP, etc.) live in [`.claude/CLAUDE.md`](../.claude/CLAUDE.md#security-architecture). This file holds operational policies that don't fit inline in the build-guide doc.

## CVE response policy

Dependency vulnerabilities are surfaced by:
- The `audit` job on every CI run — blocks PRs on HIGH/CRITICAL findings at install time.
- The weekly `audit-weekly.yml` job — re-audits the locked tree and opens a `security`-labeled issue on new HIGH/CRITICAL findings disclosed since the last install.

Resolution SLA:

| Severity | Time to resolve | Notes |
|---|---|---|
| CRITICAL | 7 days | Patch, pin, or pre-merge-block; document in `.pnpmauditignore` only if no fix is available and impact is mitigated. |
| HIGH | 7 days | Same as above. |
| MEDIUM | 30 days | Patch or document; review at next planning interval. |
| LOW | Tracked, not blocking | Address opportunistically. |

If a vulnerability has no upstream fix, add an entry to `.pnpmauditignore` with:
- The CVE / advisory ID.
- The dependency path.
- A one-line justification (why it's not exploitable in our usage).
- A review date (typically +90 days from add).

Never suppress without a written justification.

## Metrics endpoint protection

`GET /metrics` (Prometheus scrape endpoint) is gated by a bearer token in production. Set `METRICS_TOKEN` in the server environment; the endpoint returns 401 if the `Authorization: Bearer <token>` header doesn't match. In development (`METRICS_TOKEN` unset) the endpoint is open. See `.env.example` for generation command.

## Secrets scanning

`gitleaks` runs on every PR via `.github/workflows/ci.yml`. Findings block the build. If a secret was committed historically, rotate it — removing it from git history without rotation is not sufficient.

**Local pre-commit gap:** CI scans on push but there is no local pre-commit hook yet. Add one to catch secrets before they leave the machine:
```bash
# requires gitleaks installed (https://github.com/gitleaks/gitleaks)
cat > .git/hooks/pre-commit << 'EOF'
#!/bin/sh
gitleaks protect --staged --redact --no-banner
EOF
chmod +x .git/hooks/pre-commit
```
