/**
 * mfa-orphans.test.ts
 *
 * Regression guard for PR-D: MFA orphan cleanup.
 *
 * MFA was fully removed in 2026-05-17 to restore single-step login, but a set of
 * dead artifacts lingered for ~2 days:
 *   - 3 error codes (AUTH_MFA_REQUIRED / _INVALID / _USED)
 *   - 17 i18n keys (EN + AR) across the Login flow and the /mfa-setup wizard
 *   - 1 always-accessible route exception for `/mfa-setup`
 *
 * This test pins the deletion with an explicit allowlist. A Phase 15 re-implementation
 * can add new keys like `mfaSetupHelp` without tripping the test — only the listed
 * keys are forbidden. If you intend to remove this test, also remove the matching
 * comment in CLAUDE.md ("MFA status: ... completely removed").
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { E } from "../errors";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const I18N_PATH = path.join(REPO_ROOT, "artifacts/clinic/src/hooks/i18n.tsx");
const ROUTE_ACCESS_PATH = path.join(REPO_ROOT, "artifacts/clinic/src/lib/route-access.ts");

const REMOVED_I18N_KEYS = [
  // Two-step login
  "mfaRequired",
  "enterTotpCode",
  "verifyCode",
  "useRecoveryCode",
  "useAuthenticatorCode",
  "invalidTotpCode",
  "mfaSessionExpired",
  // Mandatory MFA setup wizard
  "mfaSetupRequired",
  "mfaSetupRequiredDesc",
  "mfaSetupStep1",
  "mfaSetupStep2",
  "mfaSetupStep2Desc",
  "mfaSetupStep3",
  "mfaSetupConfirm",
  "mfaSetupSuccess",
  "mfaSetupCopied",
  "mfaSetupSavedConfirm",
] as const;

describe("PR-D: MFA orphan cleanup", () => {
  const i18nContents = fs.readFileSync(I18N_PATH, "utf8");
  const routeAccessContents = fs.readFileSync(ROUTE_ACCESS_PATH, "utf8");

  it.each(REMOVED_I18N_KEYS)("i18n key %s is absent from i18n.tsx (EN + AR)", (key) => {
    // Match the key as an object property: `  keyName:` — avoids false positives
    // from substring matches like `verifyCodeButton`.
    const re = new RegExp(`(^|\\s)${key}\\s*:`, "m");
    expect(i18nContents).not.toMatch(re);
  });

  it("route-access does not special-case /mfa-setup", () => {
    expect(routeAccessContents).not.toMatch(/\/mfa-setup/);
  });

  it.each(["AUTH_MFA_REQUIRED", "AUTH_MFA_INVALID", "AUTH_MFA_USED"] as const)(
    "error code %s is absent from the E map",
    (key) => {
      expect((E as Record<string, unknown>)[key]).toBeUndefined();
    },
  );
});
