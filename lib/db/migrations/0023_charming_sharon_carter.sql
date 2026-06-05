-- Migration 0023: Per-clinic invoice counter table.
--
-- Replaces the global invoice_seq PostgreSQL sequence with a per-clinic counter
-- table. The global sequence leaked cross-tenant invoice volume: Clinic B could
-- observe that INV-202606-000312 was issued and infer Clinic A has more business.
--
-- Design: UPDATE clinic_invoice_counters SET last_seq = last_seq + 1
--         WHERE clinic_id = $1 RETURNING last_seq
-- The UPDATE is atomic — no SELECT FOR UPDATE needed. Format stays
-- INV-{YYYYMM}-{seq padded to 6} so external invoice numbers are unchanged.
--
-- Backfill: seed every clinic that already has invoices at 0 (new installs)
-- or at the highest existing seq for that clinic extracted from invoice_number.
-- Format is INV-YYYYMM-NNNNNN; we take MAX(NNNNNN) per clinic. If the format
-- doesn't parse (custom / legacy), we seed at 0 and let it count up from there.

CREATE TABLE "clinic_invoice_counters" (
  "clinic_id" integer PRIMARY KEY NOT NULL,
  "last_seq"  bigint DEFAULT 0 NOT NULL,
  CONSTRAINT "clinic_invoice_counters_clinic_id_clinics_id_fk"
    FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- Seed all existing clinics: start each clinic's counter at the highest seq
-- number already in their invoices (parsed from invoice_number suffix), or 0.
INSERT INTO clinic_invoice_counters (clinic_id, last_seq)
SELECT
  c.id AS clinic_id,
  COALESCE(
    MAX(
      CASE
        WHEN i.invoice_number ~ '^INV-\d{6}-\d+$'
        THEN (regexp_match(i.invoice_number, '-(\d+)$'))[1]::bigint
        ELSE 0
      END
    ),
    0
  ) AS last_seq
FROM clinics c
LEFT JOIN invoices i ON i.clinic_id = c.id
GROUP BY c.id
ON CONFLICT (clinic_id) DO NOTHING;

-- Grant DML to the app role (default privileges cover future tables, but this
-- table is created here by the bootstrap owner so we grant explicitly).
GRANT SELECT, INSERT, UPDATE ON clinic_invoice_counters TO medicore_app;

-- Drop the old global sequence once the table is in place.
-- Applications must be deployed with the new counter code before this runs,
-- but since migrations run before the api/worker start (init-migrate container),
-- the old sequence is safe to drop at migration time.
DROP SEQUENCE IF EXISTS invoice_seq;
