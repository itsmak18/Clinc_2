CREATE INDEX "patient_clinic_phone_idx" ON "patients" USING btree ("clinic_id","phone");--> statement-breakpoint
CREATE INDEX "patient_clinic_active_idx" ON "patients" USING btree ("clinic_id","is_active");--> statement-breakpoint
CREATE INDEX "appt_clinic_doctor_scheduled_idx" ON "appointments" USING btree ("clinic_id","doctor_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appt_clinic_scheduled_status_idx" ON "appointments" USING btree ("clinic_id","scheduled_at","status");--> statement-breakpoint
CREATE INDEX "mr_clinic_patient_created_idx" ON "medical_records" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "mr_clinic_doctor_created_idx" ON "medical_records" USING btree ("clinic_id","doctor_id","created_at");--> statement-breakpoint
CREATE INDEX "rx_clinic_patient_created_idx" ON "prescriptions" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "xray_clinic_patient_created_idx" ON "xray_records" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "xray_clinic_status_created_idx" ON "xray_records" USING btree ("clinic_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ultrasound_clinic_patient_created_idx" ON "ultrasound_records" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "ultrasound_clinic_status_created_idx" ON "ultrasound_records" USING btree ("clinic_id","status","created_at");--> statement-breakpoint
CREATE INDEX "lab_clinic_patient_created_idx" ON "lab_tests" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "lab_clinic_status_created_idx" ON "lab_tests" USING btree ("clinic_id","status","created_at");--> statement-breakpoint
CREATE INDEX "invoice_clinic_patient_created_idx" ON "invoices" USING btree ("clinic_id","patient_id","created_at");--> statement-breakpoint
CREATE INDEX "invoice_clinic_status_created_idx" ON "invoices" USING btree ("clinic_id","status","created_at");