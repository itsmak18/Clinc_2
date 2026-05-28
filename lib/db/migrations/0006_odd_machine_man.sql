CREATE TABLE "audit_outbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"clinic_id" integer DEFAULT 1 NOT NULL,
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
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
