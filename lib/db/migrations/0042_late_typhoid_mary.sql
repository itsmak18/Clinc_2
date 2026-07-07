CREATE TYPE "public"."clearance_status" AS ENUM('pending', 'cleared', 'overridden', 'expired');--> statement-breakpoint
CREATE TYPE "public"."invoice_kind" AS ENUM('manual', 'order_basket');--> statement-breakpoint
ALTER TABLE "xray_records" ADD COLUMN "clearance_status" "clearance_status" DEFAULT 'cleared' NOT NULL;--> statement-breakpoint
ALTER TABLE "xray_records" ADD COLUMN "invoice_item_id" integer;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD COLUMN "clearance_status" "clearance_status" DEFAULT 'cleared' NOT NULL;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD COLUMN "invoice_item_id" integer;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD COLUMN "clearance_status" "clearance_status" DEFAULT 'cleared' NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD COLUMN "invoice_item_id" integer;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "kind" "invoice_kind" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "xray_records" ADD CONSTRAINT "xray_records_invoice_item_id_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ultrasound_records" ADD CONSTRAINT "ultrasound_records_invoice_item_id_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_invoice_item_id_invoice_items_id_fk" FOREIGN KEY ("invoice_item_id") REFERENCES "public"."invoice_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "xray_clearance_idx" ON "xray_records" USING btree ("clinic_id","clearance_status");--> statement-breakpoint
CREATE INDEX "ultrasound_clearance_idx" ON "ultrasound_records" USING btree ("clinic_id","clearance_status");--> statement-breakpoint
CREATE INDEX "lab_clearance_idx" ON "lab_tests" USING btree ("clinic_id","clearance_status");--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_open_basket_uq" ON "invoices" USING btree ("clinic_id","patient_id") WHERE kind = 'order_basket' AND status = 'pending' AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "services_catalog_clinic_code_idx" ON "services_catalog" USING btree ("clinic_id","code") WHERE code IS NOT NULL;