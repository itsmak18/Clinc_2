import { useState } from "react";
import {
  useListUltrasoundRecords, useCreateUltrasoundRecord, useUpdateUltrasoundRecord,
  useListPatients, useListUsers,
  getListUltrasoundRecordsQueryKey, getListPatientsQueryKey, getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { openPrintWindow, ultrasoundReportHtml } from "@/lib/print";
import { Plus, Waves, Printer, ChevronDown, ChevronUp } from "lucide-react";

const STATUS_SORT_ORDER: Record<string, number> = { pending: 0, uploaded: 1, reviewed: 2 };
const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(\?.*)?$/i;
const EXAM_TYPES = ["Abdominal", "Pelvic", "Cardiac", "Obstetric", "Thyroid", "Vascular", "Other"] as const;

function parseReport(raw: string | null | undefined): { findings: string; impression: string } {
  if (!raw) return { findings: "", impression: "" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 1) return { findings: parsed.findings ?? "", impression: parsed.impression ?? "" };
  } catch { /* plain text */ }
  return { findings: raw, impression: "" };
}

function serializeReport(findings: string, impression: string): string {
  return JSON.stringify({ v: 1, findings, impression });
}

export default function Ultrasound() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ patientId: "", requestedById: "", examType: "", bodyPart: "", notes: "" });

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [findings, setFindings] = useState("");
  const [impression, setImpression] = useState("");
  const [reportStatus, setReportStatus] = useState("uploaded");

  const filterParams = { status: filterStatus as any || undefined };
  const { data: records, isLoading } = useListUltrasoundRecords(filterParams, { query: { queryKey: getListUltrasoundRecordsQueryKey(filterParams) } });
  const { data: patients } = useListPatients({ limit: 200 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200 }) } });
  const { data: doctors }  = useListUsers({ role: "doctor" as any }, { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } });

  const createMutation = useCreateUltrasoundRecord({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUltrasoundRecordsQueryKey() });
        setShowCreate(false);
        setForm({ patientId: "", requestedById: "", examType: "", bodyPart: "", notes: "" });
        toast({ title: t("ultrasoundRecordCreated") });
      },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const updateMutation = useUpdateUltrasoundRecord({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUltrasoundRecordsQueryKey() });
        setExpandedId(null);
        toast({ title: t("ultrasoundUpdated") });
      },
    },
  });

  const statuses = ["pending", "uploaded", "reviewed"];
  const allRecords = records ?? [];
  const pendingCount = allRecords.filter(r => r.status === "pending" || r.status === "uploaded").length;

  function openInline(record: NonNullable<typeof records>[number]) {
    if (expandedId === record.id) { setExpandedId(null); return; }
    const parsed = parseReport(record.report);
    setFindings(parsed.findings);
    setImpression(parsed.impression);
    setImageUrl(record.imageUrl || "");
    setReportStatus(record.status);
    setExpandedId(record.id);
  }

  function handlePrint() {
    const record = allRecords.find(r => r.id === expandedId);
    if (!record) return;
    openPrintWindow(
      ultrasoundReportHtml({ createdAt: record.createdAt, examType: record.examType, bodyPart: record.bodyPart, patient: record.patient as any, requestedBy: record.requestedBy as any, findings, impression, imageUrl }),
      `Ultrasound Report - ${record.examType}`
    );
  }

  const sortedFiltered = [...allRecords]
    .filter(r => {
      if (!search) return true;
      const q = search.toLowerCase();
      return r.patient?.fullName?.toLowerCase().includes(q) || r.examType?.toLowerCase().includes(q) || r.bodyPart?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (filterStatus) return 0;
      return (STATUS_SORT_ORDER[a.status] ?? 99) - (STATUS_SORT_ORDER[b.status] ?? 99);
    });

  return (
    <div className="page">
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <Input
          className="h-8 text-sm max-w-xs"
          placeholder={t("searchByPatientExamOrBodyPart")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <Select value={filterStatus || "all"} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 text-sm w-36" data-testid="select-filter-status">
            <SelectValue placeholder={t("all")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            {statuses.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
          </SelectContent>
        </Select>
        {pendingCount > 0 && (
          <span className="badge badge-sand text-xs">{pendingCount} {t("pending")}</span>
        )}
        <button className="btn btn-primary btn-sm gap-1.5 ms-auto" onClick={() => setShowCreate(true)} data-testid="button-create-ultrasound">
          <Plus className="w-3.5 h-3.5" /> {t("newUltrasoundRequest")}
        </button>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          data={sortedFiltered}
          emptyMessage={t("noUltrasoundRecords")}
          expandedRow={expandedId ? (row) => row.id === expandedId ? (
            <div className="p-4 bg-[var(--surface-2)] border-t border-[var(--line)] space-y-4">
              <div className="space-y-1">
                <Label className="text-xs">{t("imageUrl")}</Label>
                <Input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://…" data-testid="input-image-url" />
                {imageUrl && IMAGE_EXT_RE.test(imageUrl) && (
                  <div className="mt-2">
                    <img
                      src={imageUrl}
                      alt="Ultrasound preview"
                      loading="lazy"
                      className="h-32 rounded border border-[var(--line)] object-cover"
                      onError={e => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                        const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = "block";
                      }}
                    />
                    <p className="hidden text-xs text-[var(--ink-muted)] mt-1">{t("previewUnavailable")}</p>
                  </div>
                )}
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("findings")}</Label>
                <Textarea value={findings} onChange={e => setFindings(e.target.value)} rows={3} placeholder={t("findingsPlaceholder")} data-testid="input-findings" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("impressionConclusion")}</Label>
                <Textarea value={impression} onChange={e => setImpression(e.target.value)} rows={2} placeholder={t("impressionPlaceholder")} data-testid="input-impression" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("status")}</Label>
                <Select value={reportStatus} onValueChange={setReportStatus}>
                  <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">{t("pending")}</SelectItem>
                    <SelectItem value="uploaded">{t("uploaded")}</SelectItem>
                    <SelectItem value="reviewed">{t("reviewed")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-between gap-2">
                <button className="btn btn-outline btn-sm gap-1" onClick={handlePrint} disabled={!findings && !impression}>
                  <Printer className="w-3.5 h-3.5" /> {t("printReport")}
                </button>
                <div className="flex gap-2">
                  <button className="btn btn-outline btn-sm" onClick={() => setExpandedId(null)}>{t("cancel")}</button>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => expandedId && updateMutation.mutate({ ultrasoundId: expandedId, data: { report: serializeReport(findings, impression), imageUrl: imageUrl || undefined, status: reportStatus as any } })}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-report"
                  >
                    {updateMutation.isPending ? t("loading") : t("save")}
                  </button>
                </div>
              </div>
            </div>
          ) : null : undefined}
          columns={[
            {
              key: "patient",
              header: t("patient"),
              render: r => (
                <div>
                  <span className="font-medium text-[13px] text-[var(--ink)]">{r.patient?.fullName || `#${r.patientId}`}</span>
                  {(r.patient as any)?.mrn && <div className="text-[11px] text-[var(--ink-muted)] font-mono">{(r.patient as any).mrn}</div>}
                </div>
              ),
            },
            { key: "examType",   header: t("examType"),   render: r => <span className="text-[13px] font-medium text-[var(--ink)]">{r.examType}</span> },
            { key: "body",       header: t("bodyPart"),   render: r => <span className="text-[13px] text-[var(--ink)]">{r.bodyPart}</span> },
            {
              key: "report",
              header: t("reportSummary"),
              render: r => {
                const { findings: f, impression: imp } = parseReport(r.report);
                if (!f && !imp) return <span className="text-[12px] text-[var(--ink-muted)]">{t("noReportYet")}</span>;
                return (
                  <div className="text-[12px] space-y-0.5">
                    {f   && <p className="text-[var(--ink-muted)] line-clamp-1"><span className="font-medium text-[var(--ink)]">{t("findings")}:</span> {f}</p>}
                    {imp && <p className="text-[var(--ink-muted)] line-clamp-1"><span className="font-medium text-[var(--ink)]">{t("impression")}:</span> {imp}</p>}
                  </div>
                );
              },
            },
            { key: "requested", header: t("requestedBy"), render: r => <span className="text-[13px] text-[var(--ink)]">{r.requestedBy?.fullName || `#${r.requestedById}`}</span> },
            { key: "date",      header: t("date"),        render: r => <span className="text-[12px] text-[var(--ink-muted)]">{formatDate(r.createdAt)}</span> },
            { key: "status",    header: t("status"),      render: r => <StatusBadge status={r.status} /> },
            {
              key: "actions",
              header: t("actions"),
              render: r => (
                <button
                  className={cn("btn btn-sm h-6 text-xs px-2 gap-1", expandedId === r.id ? "btn-primary" : "btn-outline")}
                  onClick={e => { e.stopPropagation(); openInline(r); }}
                  data-testid={`button-report-${r.id}`}
                >
                  <Waves className="w-3 h-3" />
                  {expandedId === r.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              ),
            },
          ]}
        />
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("newUltrasoundRequest")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("patient")} *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                <SelectTrigger><SelectValue placeholder={t("selectPatient")} /></SelectTrigger>
                <SelectContent>{patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("requestedByDoctor")} *</Label>
              <Select value={form.requestedById} onValueChange={v => setForm(f => ({ ...f, requestedById: v }))}>
                <SelectTrigger><SelectValue placeholder={t("selectDoctor2")} /></SelectTrigger>
                <SelectContent>{doctors?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("examType")} *</Label>
              <Select value={form.examType} onValueChange={v => setForm(f => ({ ...f, examType: v }))}>
                <SelectTrigger data-testid="select-exam-type"><SelectValue placeholder={t("selectPatient")} /></SelectTrigger>
                <SelectContent>
                  {EXAM_TYPES.map(et => <SelectItem key={et} value={et}>{t(`examType${et}` as any)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("bodyPart")} *</Label>
              <Input value={form.bodyPart} onChange={e => setForm(f => ({ ...f, bodyPart: e.target.value }))} placeholder="e.g. Upper Abdomen, Uterus…" data-testid="input-body-part" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => createMutation.mutate({ data: { patientId: parseInt(form.patientId), requestedById: parseInt(form.requestedById), examType: form.examType, bodyPart: form.bodyPart, notes: form.notes || undefined } as any })}
                disabled={createMutation.isPending || !form.patientId || !form.requestedById || !form.examType || !form.bodyPart}
                data-testid="button-save-ultrasound"
              >
                {createMutation.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
