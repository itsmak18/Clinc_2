CREATE TABLE "clinics" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"address" text,
	"phone" text,
	"email" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Seed the default clinic (id=1) BEFORE adding FK constraints on existing PHI
-- rows — every PHI table's clinic_id defaults to 1 and the FK validation
-- requires that row to already exist. Plan item E1.
INSERT INTO "clinics" ("id", "name", "name_ar")
VALUES (1, 'Default Clinic', 'العيادة الافتراضية')
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- Advance the clinics_id_seq past the seeded row so subsequent INSERTs that
-- omit id don't collide with id=1.
SELECT setval('clinics_id_seq', 1, true);
--> statement-breakpoint
ALTER TABLE "patients" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "medical_records" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "xray_records" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "break_glass_sessions" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD COLUMN "clinic_id" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_records" ADD CONSTRAINT "xray_records_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD CONSTRAINT "ultrasound_records_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_clinic_id_clinics_id_fk" FOREIGN KEY ("clinic_id") REFERENCES "public"."clinics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_clinic_idx" ON "patients" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "appt_clinic_idx" ON "appointments" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "mr_clinic_idx" ON "medical_records" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "rx_clinic_idx" ON "prescriptions" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "xray_clinic_idx" ON "xray_records" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "ultrasound_clinic_idx" ON "ultrasound_records" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "lab_clinic_idx" ON "lab_tests" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "invoice_clinic_idx" ON "invoices" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "notif_clinic_idx" ON "notifications" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "audit_clinic_idx" ON "audit_logs" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "inv_items_clinic_idx" ON "invoice_items" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "consent_clinic_idx" ON "patient_consents" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "bgs_clinic_idx" ON "break_glass_sessions" USING btree ("clinic_id");--> statement-breakpoint
CREATE INDEX "erasure_clinic_idx" ON "erasure_requests" USING btree ("clinic_id");