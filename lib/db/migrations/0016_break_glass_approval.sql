-- Migration 0016: break-glass compliance approval gate.
--
-- Phase 3.4 of the 2026-05-30 remediation roadmap. The board review flagged
-- break-glass as "self-grant: detective, not preventive — an auditor will ask
-- why there is no approval gate." Phase 0.4 narrowed the role gate (only
-- clinical roles can activate) and added a structured reason category, but
-- approval remained automatic.
--
-- This migration adds the columns that back the new approval workflow:
--
--   approved_at:           timestamp the compliance_officer approved this session.
--                          NULL means the session is in its 5-minute grace window
--                          (during which it grants access but auto-expires
--                          unless approved). Non-NULL extends validity through
--                          expires_at as before.
--   approved_by_user_id:   FK to users — who approved.
--
-- The service-layer change at break-glass.service.ts treats a session as active
-- when:
--   revoked_at IS NULL AND (
--     (approved_at IS NOT NULL AND expires_at > NOW())
--     OR (approved_at IS NULL AND activated_at > NOW() - INTERVAL '5 minutes')
--   )
--
-- This is purely additive; existing rows have approved_at = NULL. To avoid
-- breaking any in-flight historical sessions (none exist in prod yet, the
-- system hasn't been deployed, but defense-in-depth), we backfill approved_at
-- to activated_at for any session that's already past its grace window — those
-- were issued under the pre-3.4 model and behaved as auto-approved.

ALTER TABLE "break_glass_sessions"
  ADD COLUMN IF NOT EXISTS "approved_at" timestamp,
  ADD COLUMN IF NOT EXISTS "approved_by_user_id" integer REFERENCES "users"("id");

-- Backfill historical rows so they don't suddenly auto-expire at grace.
UPDATE "break_glass_sessions"
SET    "approved_at" = "activated_at"
WHERE  "approved_at" IS NULL
  AND  "activated_at" < NOW() - INTERVAL '5 minutes';
