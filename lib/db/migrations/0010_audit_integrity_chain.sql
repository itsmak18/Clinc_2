CREATE TABLE IF NOT EXISTS "audit_integrity_checks" (
  "id" serial PRIMARY KEY NOT NULL,
  "checked_date" date NOT NULL,
  "row_count" integer NOT NULL,
  "root_hash" text NOT NULL,
  "prev_hash" text NOT NULL,
  "status" text NOT NULL,
  "verified_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "audit_integrity_date_idx" ON "audit_integrity_checks" ("checked_date");
