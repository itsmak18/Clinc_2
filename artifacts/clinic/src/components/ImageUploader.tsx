import { useRef, useState } from "react";
import {
  uploadXrayImage, uploadUltrasoundImage,
  useDeleteXrayImage, useDeleteUltrasoundImage,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useToast } from "@/hooks/use-toast";
import { Upload, Download, Trash2, ImageOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type UploaderImage = { url: string; caption?: string };

type Modality = "xray" | "ultrasound";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 25 * 1024 * 1024;

// A server-stored image's url is /api/{modality}/{recordId}/images/{uuid}; legacy
// rows hold an external URL we can render but not delete via our API.
function attachmentIdFromUrl(modality: Modality, recordId: number, url: string): string | null {
  const m = url.match(new RegExp(`^/api/${modality}/${recordId}/images/([0-9a-f-]{36})$`, "i"));
  return m ? m[1] : null;
}

function downloadHref(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download`;
}

/**
 * Upload / view / download / delete the image files attached to one imaging
 * study. Files are stored on the server (encrypted at rest) and served through
 * the authenticated, audited download endpoint — never an external host.
 */
export default function ImageUploader({
  modality, recordId, images, canEdit, onChanged,
}: {
  modality: Modality;
  recordId: number;
  images: UploaderImage[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const deleteXray = useDeleteXrayImage();
  const deleteUltrasound = useDeleteUltrasoundImage();

  async function handleFile(file: File) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      toast({ title: t("invalidImageType"), variant: "destructive" });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({ title: t("imageTooLarge"), variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      // The generated client builds the multipart FormData + CSRF header; `file`
      // is declared string in the spec (see ImageUploadBody) so cast for the Blob.
      const body = { file: file as unknown as string };
      if (modality === "xray") await uploadXrayImage(recordId, body);
      else await uploadUltrasoundImage(recordId, body);
      toast({ title: t("imageUploaded") });
      onChanged();
    } catch {
      toast({ title: t("failed"), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) void handleFile(f);
    e.target.value = "";
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void handleFile(f);
  }

  async function handleDelete(url: string) {
    const attId = attachmentIdFromUrl(modality, recordId, url);
    if (!attId) return;
    if (!window.confirm(t("confirmDeleteImage"))) return;
    try {
      if (modality === "xray") await deleteXray.mutateAsync({ xrayId: recordId, attachmentId: attId });
      else await deleteUltrasound.mutateAsync({ ultrasoundId: recordId, attachmentId: attId });
      toast({ title: t("imageDeleted") });
      onChanged();
    } catch {
      toast({ title: t("failed"), variant: "destructive" });
    }
  }

  return (
    <div className="space-y-2">
      {images.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {images.map((img, i) => {
            const isServer = !!attachmentIdFromUrl(modality, recordId, img.url);
            return (
              <div key={i} className="rounded-lg border border-[var(--line)] overflow-hidden bg-[var(--surface)]">
                <a href={img.url} target="_blank" rel="noopener noreferrer" className="block">
                  <img
                    src={img.url}
                    alt={img.caption || ""}
                    loading="lazy"
                    className="w-full h-28 object-cover bg-[var(--surface-2)]"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.visibility = "hidden"; }}
                  />
                </a>
                <div className="flex items-center gap-1 px-1.5 py-1">
                  {i === 0 && <span className="badge badge-teal text-[10px] flex-shrink-0">{t("cover")}</span>}
                  <span className="text-[11px] text-[var(--ink-muted)] truncate flex-1">{img.caption}</span>
                  <a
                    href={downloadHref(img.url)}
                    className="btn btn-ghost btn-sm h-6 w-6 p-0 text-[var(--ink-muted)] flex-shrink-0"
                    title={t("download")}
                  >
                    <Download className="w-3 h-3" />
                  </a>
                  {canEdit && isServer && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm h-6 w-6 p-0 text-[var(--ink-muted)] hover:text-[var(--rose-500)] flex-shrink-0"
                      onClick={() => handleDelete(img.url)}
                      title={t("deleteImage")}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-[12px] text-[var(--ink-muted)] py-2">
          <ImageOff className="w-3.5 h-3.5" /> {t("noImagesYet")}
        </div>
      )}

      {canEdit && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => !uploading && fileRef.current?.click()}
          onKeyDown={e => { if ((e.key === "Enter" || e.key === " ") && !uploading) fileRef.current?.click(); }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-3 py-4 text-[12px] cursor-pointer transition-colors",
            dragOver ? "border-[var(--teal-600)] bg-[var(--teal-50)]" : "border-[var(--line)] text-[var(--ink-muted)] hover:border-[var(--teal-600)]",
          )}
          data-testid="image-dropzone"
        >
          {uploading ? (
            <><Loader2 className="w-4 h-4 animate-spin text-[var(--teal-600)]" /> {t("uploading")}</>
          ) : (
            <><Upload className="w-4 h-4" /> {t("dropImageHere")}</>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={onPick}
            data-testid="image-file-input"
          />
        </div>
      )}
    </div>
  );
}
