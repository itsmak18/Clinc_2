-- Migrate any orphaned rows first (should be zero, but be safe)
UPDATE appointments SET status = 'in_consultation' WHERE status = 'in_progress';

-- PostgreSQL requires recreating the enum type to remove a value
ALTER TYPE appointment_status RENAME TO appointment_status_old;
CREATE TYPE appointment_status AS ENUM (
  'scheduled','checked_in','in_triage','ready_for_doctor',
  'in_consultation','awaiting_diagnostics','pending_payment',
  'completed','cancelled','no_show'
);
ALTER TABLE appointments ALTER COLUMN status TYPE appointment_status
  USING status::text::appointment_status;
DROP TYPE appointment_status_old;
