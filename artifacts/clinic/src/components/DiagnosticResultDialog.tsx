import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import StatusBadge from "@/components/StatusBadge";
import { Download } from "lucide-react";
import { useI18n } from "@/hooks/i18n";
import { formatDate } from "@/lib/api";
import type { XrayRecord, UltrasoundRecord, LabTest, MediaImage } from "@workspace/api-client-react";

export type DiagnosticKind = "xray" | "ultrasound" | "lab";

interface DiagnosticResultDialogProps {
  kind: DiagnosticKind;
  /** The record to show; the dialog is open while this is non-null. */
  record: XrayRecord | UltrasoundRecord | LabTest | null;
  onClose: () => void;
}

/**
 * Read-only viewer for a diagnostic result: imaging studies (x-ray / ultrasound)
 * show their image(s) + radiology report; lab tests show their results text.
 * Pending/requested studies show a "not ready yet" placeholder.
 */
export default function DiagnosticResultDialog({ kind, record, onClose }: DiagnosticResultDialogProps) {
  const { t } = useI18n();
  const rec = record as any;
  const isImaging = kind !== "lab";

  const title = !rec
    ? ""
    : kind === "lab"
      ? rec.testName
      : kind === "ultrasound" && rec.examType
        ? `${rec.examType} — ${rec.bodyPart}`
        : rec.bodyPart;

  // images[] already carries the cover (its url is mirrored into imageUrl for
  // back-compat); fall back to imageUrl only when the list is empty.
  const images: MediaImage[] = isImaging && rec
    ? (rec.images?.length ? rec.images : rec.imageUrl ? [{ url: rec.imageUrl }] : [])
    : [];
  const report: string | null = isImaging ? rec?.report ?? null : rec?.results ?? null;
  const hasContent = images.length > 0 || !!report;

  return (
    <Dialog open={!!record} onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap pe-6">
            <span>{title}</span>
            {rec && <StatusBadge status={rec.status} />}
            {rec?.createdAt && (
              <span className="text-[11px] font-normal text-[var(--ink-muted)] ms-auto">{formatDate(rec.createdAt)}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {!hasContent ? (
          <div className="py-10 text-center text-[13px] text-[var(--ink-muted)]">{t("resultsNotReady")}</div>
        ) : (
          <div className="space-y-4">
            {images.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-[var(--ink)] mb-1.5">{t("images")}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {images.map((img, i) => (
                    <div key={i} className="group">
                      <div className="relative">
                        <a href={img.url} target="_blank" rel="noopener noreferrer" className="block">
                          <img
                            src={img.url}
                            alt={img.caption || title}
                            className="w-full rounded-[var(--r-sm)] border border-[var(--line)] object-contain bg-[var(--surface-2)] group-hover:opacity-90 transition-opacity"
                          />
                        </a>
                        <a
                          href={`${img.url}${img.url.includes("?") ? "&" : "?"}download`}
                          className="btn btn-outline btn-sm h-7 w-7 p-0 absolute top-1.5 end-1.5 bg-[var(--surface)] opacity-0 group-hover:opacity-100 transition-opacity"
                          title={t("download")}
                          aria-label={t("download")}
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      </div>
                      {img.caption && <p className="text-[11px] text-[var(--ink-muted)] mt-1">{img.caption}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {report && (
              <div>
                <p className="text-xs font-semibold text-[var(--ink)] mb-1.5">{isImaging ? t("report") : t("results")}</p>
                <p className="text-[13px] text-[var(--ink)] whitespace-pre-wrap leading-relaxed">{report}</p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
