CREATE TYPE "public"."consent_type" AS ENUM('treatment', 'data_sharing', 'research', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."erasure_status" AS ENUM('pending', 'approved', 'rejected', 'executed');--> statement-breakpoint
CREATE TABLE "patient_consents" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"consent_type" "consent_type" NOT NULL,
	"granted_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"granted_by_user_id" integer NOT NULL,
	"ip_address" text NOT NULL,
	"document_version" text NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "break_glass_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"patient_id" integer NOT NULL,
	"justification" text NOT NULL,
	"activated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"revoked_by_user_id" integer,
	"alert_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "erasure_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"patient_id" integer NOT NULL,
	"requested_by_user_id" integer NOT NULL,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"status" "erasure_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"executed_by_user_id" integer,
	"executed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "break_glass_sessions" ADD CONSTRAINT "break_glass_sessions_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_requests" ADD CONSTRAINT "erasure_requests_executed_by_user_id_users_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_patient_idx" ON "patient_consents" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "consent_patient_type_idx" ON "patient_consents" USING btree ("patient_id","consent_type");--> statement-breakpoint
CREATE INDEX "bgs_user_idx" ON "break_glass_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bgs_patient_idx" ON "break_glass_sessions" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "bgs_expires_idx" ON "break_glass_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "erasure_patient_idx" ON "erasure_requests" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "erasure_status_idx" ON "erasure_requests" USING btree ("status");