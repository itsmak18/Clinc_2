CREATE TABLE "user_devices" (
	"user_id" integer NOT NULL,
	"device_id" uuid NOT NULL,
	"fingerprint_hash" text NOT NULL,
	"ip_last" text,
	"asn_last" integer,
	"country_last" text,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"trusted" boolean DEFAULT false NOT NULL,
	"trust_source" text,
	"trust_expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "user_devices_user_id_device_id_pk" PRIMARY KEY("user_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "device_verification_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"pending_device_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"fingerprint_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "device_verification_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "csp_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"document_uri" text,
	"referrer" text,
	"violated_directive" text,
	"effective_directive" text,
	"original_policy" text,
	"disposition" text,
	"blocked_uri" text,
	"status_code" integer,
	"source_file" text,
	"line_number" integer,
	"column_number" integer,
	"script_sample" text,
	"raw" jsonb,
	"user_agent" text,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" text NOT NULL,
	"source" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "user_devices" ADD CONSTRAINT "user_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_verification_tokens" ADD CONSTRAINT "device_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_devices_fingerprint_idx" ON "user_devices" USING btree ("user_id","fingerprint_hash");--> statement-breakpoint
CREATE INDEX "user_devices_trust_expiry_idx" ON "user_devices" USING btree ("trust_expires_at");--> statement-breakpoint
CREATE INDEX "device_verification_tokens_user_idx" ON "device_verification_tokens" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "device_verification_tokens_fp_idx" ON "device_verification_tokens" USING btree ("user_id","fingerprint_hash");--> statement-breakpoint
CREATE INDEX "csp_reports_directive_idx" ON "csp_reports" USING btree ("violated_directive","created_at");--> statement-breakpoint
CREATE INDEX "csp_reports_created_at_idx" ON "csp_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "password_reset_tokens_user_idx" ON "password_reset_tokens" USING btree ("user_id","created_at");