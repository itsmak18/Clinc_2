ALTER TABLE "xray_records" ADD COLUMN "images" jsonb;--> statement-breakpoint
ALTER TABLE "xray_records" ADD COLUMN "order_group_id" text;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD COLUMN "images" jsonb;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD COLUMN "order_group_id" text;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD COLUMN "order_group_id" text;--> statement-breakpoint
CREATE INDEX "xray_order_group_idx" ON "xray_records" USING btree ("clinic_id","order_group_id");--> statement-breakpoint
CREATE INDEX "ultrasound_order_group_idx" ON "ultrasound_records" USING btree ("clinic_id","order_group_id");--> statement-breakpoint
CREATE INDEX "lab_order_group_idx" ON "lab_tests" USING btree ("clinic_id","order_group_id");