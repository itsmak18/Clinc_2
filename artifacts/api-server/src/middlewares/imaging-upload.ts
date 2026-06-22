import multer, { MulterError } from "multer";
import type { Request, Response, NextFunction } from "express";
import { ValidationError } from "../services/errors";

// In-memory single-file upload for imaging attachments. The bytes are encrypted
// and written to disk by the service, so memoryStorage (not diskStorage) is
// correct here. The 25 MB cap mirrors MAX_FILE_BYTES in imaging-attachments.service.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

/**
 * Wraps `multer.single(field)` and translates Multer's own errors (e.g.
 * file-too-large) into the canonical 400 ValidationError envelope instead of a
 * raw 500. Content-type sniffing + the allowlist live in the service so the
 * decision is made on real bytes, not the client-declared MIME.
 */
export function uploadSingleImage(field = "file") {
  const handler = upload.single(field);
  return (req: Request, res: Response, next: NextFunction): void => {
    handler(req, res, (err: unknown) => {
      if (err instanceof MulterError) {
        next(new ValidationError(
          err.code === "LIMIT_FILE_SIZE" ? "File exceeds the 25 MB limit" : `Upload error: ${err.message}`,
        ));
        return;
      }
      if (err) { next(err); return; }
      next();
    });
  };
}
