CREATE TABLE "doctor_patients" (
	"clinic_id" integer DEFAULT 1 NOT NULL,
	"doctor_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_patients_doctor_id_patient_id_pk" PRIMARY KEY("doctor_id","patient_id")
);
--> statement-breakpoint
ALTER TABLE "doctor_patients" ADD CONSTRAINT "doctor_patients_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_patients" ADD CONSTRAINT "doctor_patients_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_patients" ADD CONSTRAINT "doctor_patients_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dp_doctor_idx" ON "doctor_patients" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "dp_clinic_idx" ON "doctor_patients" USING btree ("clinic_id");--> statement-breakpoint
-- Backfill: populate doctor_patients from existing appointments.
-- DISTINCT ON picks the most recent scheduled_at per (doctor_id, patient_id) as last_seen_at.
-- ON CONFLICT makes this idempotent if the migration is ever re-run.
INSERT INTO "doctor_patients" ("clinic_id", "doctor_id", "patient_id", "last_seen_at")
SELECT DISTINCT ON (doctor_id, patient_id)
  clinic_id, doctor_id, patient_id, scheduled_at
FROM appointments
ORDER BY doctor_id, patient_id, scheduled_at DESC
ON CONFLICT (doctor_id, patient_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at;