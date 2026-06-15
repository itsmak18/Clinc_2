ALTER TABLE "patients" ADD COLUMN "id_card_number" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "patient_clinic_idcard_uq" ON "patients" USING btree ("clinic_id","id_card_number");