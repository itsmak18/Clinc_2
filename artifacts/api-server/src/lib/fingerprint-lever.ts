/**
 * Single source of truth for the two fph emergency levers (AUD-SEC-07 / F13).
 *
 * The kernel (`policy.ts`) and the legacy verifier (`auth.ts`) both enforce
 * fingerprint binding; before this module they each re-read
 * `process.env.FINGERPRINT_BINDING` inline, so the prod-guard/TTL/observability
 * had nowhere central to live. The finding: `FINGERPRINT_BINDING=disabled` was
 * honored in production with **no NODE_ENV guard, no TTL, and no metric/alert**
 * — an operator who set it during an incident (or a leaked/stale env) would
 * silently disable fph verification indefinitely with nothing surfacing it.
 *
 * Fixes, all in one place:
 *  - **Prod TTL guard.** In production the bypass MUST carry an explicit
 *    `FINGERPRINT_BINDING_EXPIRES_AT` (unix seconds) and stops applying the
 *    moment `now` passes it. No TTL, or an expired one, ⇒ the bypass is refused
 *    and fph re-enforces (fail-secure). A forgotten `disabled` flag therefore
 *    re-enables verification on its own instead of staying off forever. Dev/test
 *    keep the un-gated behavior so local debugging and the existing unit tests
 *    are unaffected.
 *  - **Loud, throttled logging** on every engage and every prod-refusal, so the
 *    lever is never silent.
 *  - **A scrape-time gauge** (`fingerprint_binding_disabled`, set in
 *    `metrics.ts::renderMetrics`) that drives the `FingerprintBindingDisabled`
 *    Prometheus alert.
 *
 * Reads `process.env` live rather than `config.*` for the same reason
 * `checkMetricsAuth` does: `config` is snapshotted once at module load, but the
 * unit tests mutate these vars per-case afterwards. See CLAUDE.md's note on the
 * Phase-2 `auth-constants.ts` helpers.
 */
import { logger } from "./logger";

// Throttle the warn logs so a hot verification path can't spam the log at
// request rate — one line per reason per minute is enough to notice.
const WARN_THROTTLE_MS = 60_000;
const lastWarnAt: Record<string, number> = {};

function warnThrottled(reason: string, detail: Record<string, unknown>): void {
  const now = Date.now();
  if (now - (lastWarnAt[reason] ?? 0) < WARN_THROTTLE_MS) return;
  lastWarnAt[reason] = now;
  logger.warn({ op: "fingerprint_lever", reason, ...detail });
}

/**
 * True when the `FINGERPRINT_BINDING=disabled` bypass is *actively* skipping
 * fph verification for this call. In production this additionally requires a
 * valid, un-expired `FINGERPRINT_BINDING_EXPIRES_AT`; otherwise the bypass is
 * refused (fph re-enforced) and a throttled warning is logged.
 *
 * Pure w.r.t. its `nowSec` argument so callers (enforcement + the metric
 * setter) evaluate identical state; defaults to wall-clock.
 */
export function fingerprintBypassActive(nowSec: number = Math.floor(Date.now() / 1000)): boolean {
  if (process.env.FINGERPRINT_BINDING !== "disabled") return false;

  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const expiresAt = Number(process.env.FINGERPRINT_BINDING_EXPIRES_AT ?? 0);
    if (!(expiresAt > 0)) {
      warnThrottled("prod-no-ttl", {
        detail: "FINGERPRINT_BINDING=disabled ignored in production without FINGERPRINT_BINDING_EXPIRES_AT — fph re-enforced (fail-secure)",
      });
      return false;
    }
    if (nowSec > expiresAt) {
      warnThrottled("prod-expired", {
        detail: "FINGERPRINT_BINDING=disabled expired — fph re-enforced",
        expiresAt,
      });
      return false;
    }
    warnThrottled("engaged-prod", {
      detail: "fph verification is bypassed by the FINGERPRINT_BINDING emergency lever",
      expiresAt,
    });
    return true;
  }

  // Dev/test: honored unconditionally (unchanged legacy behavior).
  return true;
}

/**
 * True when a token lacking `fph` is allowed through the grandfather window
 * (`FPH_GRANDFATHER_UNTIL` ≥ the token's `iat`). This lever self-expires by
 * design — a token minted after the cutoff must carry `fph` — so it needs no
 * TTL guard of its own; centralized here only so both enforcement sites share
 * one implementation.
 */
export function fphGrandfatherActive(iat: number): boolean {
  const until = Number(process.env.FPH_GRANDFATHER_UNTIL ?? 0);
  return until > 0 && iat <= until;
}
