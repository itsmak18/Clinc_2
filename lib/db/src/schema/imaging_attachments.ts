import { pgTable, uuid, text, integer, timestamp, index } from "drizzle-orm/pg-core";
import { clinicsTable } from "./clinics";
import { patientsTable } from "./patients";
import { usersTable } from "./users";
import { uuidV7 } from "../uuid-v7";

/**
 * imaging_attachments — authoritative record for an uploaded X-ray / ultrasound
 * image file. The bytes live on the server filesystem (storageKey, AES-256-GCM
 * encrypted at rest); this table holds the metadata + crypto envelope. A display
 * projection of each row is ALSO mirrored into the parent record's `images`
 * jsonb (url → the authenticated download endpoint) so existing read/print code
 * keeps working unchanged.
 *
 * `modality` + `recordId` point at xray_records.id OR ultrasound_records.id.
 * `patientId` is denormalized so the download scope-check and right-to-erasure
 * file purge don't need a join.
 */
export const imagingAttachmentsTable = pgTable("imaging_attachments", {
  id: uuid("id").$defaultFn(uuidV7).primaryKey(),
  clinicId: integer("clinic_id").notNull().references(() => clinicsTable.id),
  modality: text("modality").notNull(), // 'xray' | 'ultrasound'
  recordId: integer("record_id").notNull(),
  patientId: integer("patient_id").notNull().references(() => patientsTable.id),
  uploadedById: integer("uploaded_by_id").notNull().references(() => usersTable.id),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  // Relative path under IMAGING_STORAGE_DIR — never returned to the client.
  storageKey: text("storage_key").notNull(),
  // AES-256-GCM envelope metadata (null when no FIELD_ENCRYPTION_KEY is set in dev).
  encKid: text("enc_kid"),
  encIv: text("enc_iv"),
  encTag: text("enc_tag"),
  caption: text("caption"),
  deletedAt: timestamp("deleted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("imaging_attach_clinic_idx").on(t.clinicId),
  index("imaging_attach_record_idx").on(t.clinicId, t.modality, t.recordId),
  index("imaging_attach_patient_idx").on(t.clinicId, t.patientId),
]);

export type ImagingAttachment = typeof imagingAttachmentsTable.$inferSelect;
