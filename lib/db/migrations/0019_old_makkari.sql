ALTER TABLE "clinics" ADD COLUMN "locale" text DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "clinics" ADD COLUMN "timezone" text DEFAULT 'Europe/Istanbul' NOT NULL;--> statement-breakpoint
ALTER TABLE "medical_records" ADD COLUMN "chief_complaint_ar" text;--> statement-breakpoint
ALTER TABLE "medical_records" ADD COLUMN "diagnosis_ar" text;--> statement-breakpoint
ALTER TABLE "medical_records" ADD COLUMN "treatment_ar" text;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "notes_ar" text;--> statement-breakpoint
ALTER TABLE "xray_records" ADD COLUMN "body_part_ar" text;--> statement-breakpoint
ALTER TABLE "xray_records" ADD COLUMN "report_ar" text;--> statement-breakpoint
ALTER TABLE "xray_records" ADD COLUMN "notes_ar" text;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD COLUMN "body_part_ar" text;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD COLUMN "report_ar" text;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD COLUMN "notes_ar" text;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD COLUMN "test_name_ar" text;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD COLUMN "results_ar" text;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD COLUMN "notes_ar" text;--> statement-breakpoint
ALTER TABLE "services_catalog" ADD COLUMN "name_ar" text;--> statement-breakpoint
ALTER TABLE "services_catalog" ADD COLUMN "description_ar" text;