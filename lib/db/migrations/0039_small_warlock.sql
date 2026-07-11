ALTER TABLE "prescriptions" ADD COLUMN "dispensed_at" timestamp;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD COLUMN "dispensed_by_id" integer;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_dispensed_by_id_users_id_fk" FOREIGN KEY ("dispensed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;