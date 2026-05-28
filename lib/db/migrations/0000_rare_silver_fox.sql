CREATE TYPE "public"."user_role" AS ENUM('super_admin', 'admin', 'doctor', 'nurse', 'front_desk', 'xray_staff', 'lab_staff', 'compliance_officer', 'billing_manager', 'pharmacist');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('male', 'female');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'checked_in', 'in_triage', 'ready_for_doctor', 'in_consultation', 'awaiting_diagnostics', 'pending_payment', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('online', 'phone', 'walk_in');--> statement-breakpoint
CREATE TYPE "public"."triage_priority" AS ENUM('normal', 'urgent', 'critical');--> statement-breakpoint
CREATE TYPE "public"."xray_status" AS ENUM('pending', 'uploaded', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."ultrasound_status" AS ENUM('pending', 'uploaded', 'reviewed');--> statement-breakpoint
CREATE TYPE "public"."lab_test_status" AS ENUM('requested', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('pending', 'paid', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."operation_status" AS ENUM('scheduled', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('patient_arrived', 'lab_ready', 'xray_ready', 'ultrasound_ready', 'general');--> statement-breakpoint
CREATE TYPE "public"."day_of_week" AS ENUM('sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"full_name_ar" text,
	"email" text,
	"role" "user_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_on_shift" boolean DEFAULT false NOT NULL,
	"phone" text,
	"specialty" text,
	"department" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" serial PRIMARY KEY NOT NULL,
	"mrn" text NOT NULL,
	"full_name" text NOT NULL,
	"full_name_ar" text,
	"date_of_birth" date NOT NULL,
	"gender" "gender" NOT NULL,
	"phone" text NOT NULL,
	"address" text,
	"blood_type" text,
	"allergies" text,
	"emergency_contact" text,
	"insurance_provider" text,
	"insurance_policy_num" text,
	"insurance_member_id" text,
	"insurance_expiry" timestamp,
	"insurance_group_num" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patients_mrn_unique" UNIQUE("mrn")
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"doctor_id" integer NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"reason" text NOT NULL,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"booking_source" "booking_source" DEFAULT 'walk_in' NOT NULL,
	"triage_priority" "triage_priority" DEFAULT 'normal' NOT NULL,
	"cancellation_reason" text,
	"notes" text,
	"checked_in_at" timestamp,
	"triage_started_at" timestamp,
	"consultation_started_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medical_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"doctor_id" integer NOT NULL,
	"appointment_id" integer,
	"chief_complaint" text NOT NULL,
	"diagnosis" text NOT NULL,
	"treatment" text NOT NULL,
	"notes" text,
	"vitals" jsonb,
	"is_global" boolean DEFAULT false NOT NULL,
	"global_reason" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"doctor_id" integer NOT NULL,
	"record_id" integer,
	"medications" jsonb NOT NULL,
	"notes" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xray_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"requested_by_id" integer NOT NULL,
	"performed_by_id" integer,
	"appointment_id" integer,
	"body_part" text NOT NULL,
	"image_url" text,
	"image_file_name" text,
	"report" text,
	"status" "xray_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ultrasound_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"requested_by_id" integer NOT NULL,
	"performed_by_id" integer,
	"exam_type" text NOT NULL,
	"body_part" text NOT NULL,
	"image_url" text,
	"image_file_name" text,
	"report" text,
	"status" "ultrasound_status" DEFAULT 'pending' NOT NULL,
	"notes" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"requested_by_id" integer NOT NULL,
	"performed_by_id" integer,
	"appointment_id" integer,
	"test_name" text NOT NULL,
	"results" text,
	"status" "lab_test_status" DEFAULT 'requested' NOT NULL,
	"notes" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_number" text NOT NULL,
	"patient_id" integer NOT NULL,
	"created_by_id" integer NOT NULL,
	"items" jsonb NOT NULL,
	"subtotal" numeric(10, 2) NOT NULL,
	"discount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"total" numeric(10, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"notes" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_invoice_number_unique" UNIQUE("invoice_number")
);
--> statement-breakpoint
CREATE TABLE "operations" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"surgeon_id" integer NOT NULL,
	"procedure_name" text NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"operating_room" text NOT NULL,
	"status" "operation_status" DEFAULT 'scheduled' NOT NULL,
	"staff_assigned" jsonb DEFAULT '[]' NOT NULL,
	"notes" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"unit" text NOT NULL,
	"minimum_stock" integer DEFAULT 0 NOT NULL,
	"expiry_date" date,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"type" "notification_type" DEFAULT 'general' NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"ip_address" text NOT NULL,
	"user_agent" text,
	"details" jsonb,
	"before_state" jsonb,
	"after_state" jsonb,
	"request_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"first_seen" timestamp with time zone NOT NULL,
	"locked_until" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"day_of_week" "day_of_week" NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"slot_minutes" integer DEFAULT 30 NOT NULL,
	"max_patients" integer DEFAULT 16 NOT NULL,
	"status" "schedule_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_schedule_unique" UNIQUE("doctor_id","day_of_week")
);
--> statement-breakpoint
CREATE TABLE "schedule_overrides" (
	"id" serial PRIMARY KEY NOT NULL,
	"doctor_id" integer NOT NULL,
	"override_date" text NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"start_time" time,
	"end_time" time,
	"reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "override_unique" UNIQUE("doctor_id","override_date")
);
--> statement-breakpoint
CREATE TABLE "services_catalog" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_price" numeric(10, 2) NOT NULL,
	"category" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"invoice_id" integer NOT NULL,
	"service_id" integer,
	"description" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_record_id_medical_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."medical_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_records" ADD CONSTRAINT "xray_records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_records" ADD CONSTRAINT "xray_records_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_records" ADD CONSTRAINT "xray_records_performed_by_id_users_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xray_records" ADD CONSTRAINT "xray_records_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD CONSTRAINT "ultrasound_records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD CONSTRAINT "ultrasound_records_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD CONSTRAINT "ultrasound_records_performed_by_id_users_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_performed_by_id_users_id_fk" FOREIGN KEY ("performed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operations" ADD CONSTRAINT "operations_surgeon_id_users_id_fk" FOREIGN KEY ("surgeon_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_overrides" ADD CONSTRAINT "schedule_overrides_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_service_id_services_catalog_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "patient_phone_idx" ON "patients" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "appt_patient_idx" ON "appointments" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "appt_doctor_idx" ON "appointments" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "appt_scheduled_idx" ON "appointments" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "appt_status_idx" ON "appointments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "appt_doctor_scheduled_idx" ON "appointments" USING btree ("doctor_id","scheduled_at");--> statement-breakpoint
CREATE UNIQUE INDEX "appt_no_double_book_idx" ON "appointments" USING btree ("doctor_id","scheduled_at") WHERE status NOT IN ('cancelled', 'no_show');--> statement-breakpoint
CREATE INDEX "appt_updated_idx" ON "appointments" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "mr_patient_idx" ON "medical_records" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "mr_doctor_idx" ON "medical_records" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "mr_created_idx" ON "medical_records" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "rx_patient_idx" ON "prescriptions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "rx_doctor_idx" ON "prescriptions" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "rx_created_idx" ON "prescriptions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "xray_patient_idx" ON "xray_records" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "xray_appt_idx" ON "xray_records" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "xray_created_idx" ON "xray_records" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "xray_status_idx" ON "xray_records" USING btree ("status");--> statement-breakpoint
CREATE INDEX "lab_patient_idx" ON "lab_tests" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "lab_appt_idx" ON "lab_tests" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "lab_created_idx" ON "lab_tests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "lab_status_idx" ON "lab_tests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoice_patient_idx" ON "invoices" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "invoice_status_idx" ON "invoices" USING btree ("status");--> statement-breakpoint
CREATE INDEX "invoice_created_idx" ON "invoices" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notif_user_idx" ON "notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notif_read_idx" ON "notifications" USING btree ("is_read");--> statement-breakpoint
CREATE INDEX "notif_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_logs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "inv_items_invoice_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "inv_items_service_idx" ON "invoice_items" USING btree ("service_id");