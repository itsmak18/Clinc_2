import { useState, useEffect } from "react";
import { useListXrayImages, useCreateXrayRecord, useUpdateXrayRecord, useListPatients, getListXrayImagesQueryKey, getListPatientsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import StatusStepper from "@/components/StatusStepper";
import PatientSearchSelect from "@/components/PatientSearchSelect";
import ImageUploader, { type UploaderImage } from "@/components/ImageUploader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { openPrintWindow, xrayReportHtml } from "@/lib/print";
import { usePrintLang } from "@/hooks/printLang";
import { newOrderGroupId, countByOrderGroup } from "@/lib/ids";
import { xrayTemplates, type ReportTemplate } from "@/lib/reportTemplates";
import { Plus, FileImage, Printer, ChevronDown, ChevronUp, ShieldCheck, Trash2, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const IMAGING_STATUSES = ["requested", "in_progress", "completed"] as const;
const STATUS_SORT_ORDER: Record<string, number> = { requested: 0, in_progress: 1, completed: 2 };
const EDIT_ROLES = ["super_admin", "admin", "xray_staff"];

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

// The live image list for a study: the images jsonb (server attachments mirrored
// here, plus any legacy external URLs), falling back to the cover.
function liveImages(record: { images?: unknown; imageUrl?: string | null }): UploaderImage[] {
  const arr = (record.images as UploaderImage[] | null) ?? [];
  if (arr.length) return arr.map(im => ({ url: im.url, caption: im.caption ?? "" }));
  if (record.imageUrl) return [{ url: record.imageUrl, caption: "" }];
  return [];
}

export default function XRay() {
  const { t } = useI18n();
  const choosePrintLang = usePrintLang();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = EDIT_ROLES.includes(user?.role ?? "");
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [showArCreate, setShowArCreate] = useState(false);
  const [showArReport, setShowArReport] = useState(false);
  // Create dialog: shared patient + notes, plus one line per body part (multi-add).
  const [patientId, setPatientId] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<{ bodyPart: string; bodyPartAr: string }[]>([{ bodyPart: "", bodyPartAr: "" }]);

  // Deep-link from the patient page (/xray?patientId=N): open the create dialog
  // pre-filled for that patient.
  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get("patientId");
    if (pid) { setPatientId(pid); setShowCreate(true); }
  }, []);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [findings, setFindings] = useState("");
  const [impression, setImpression] = useState("");
  const [findingsAr, setFindingsAr] = useState("");
  const [impressionAr, setImpressionAr] = useState("");
  const [reportStatus, setReportStatus] = useState("in_progress");

  const filterParams = { status: filterStatus as any || undefined };
  const { data: xrays, isLoading } = useListXrayImages(filterParams, { query: { queryKey: getListXrayImagesQueryKey(filterParams) } });
  const { data: patients } = useListPatients({ limit: 200 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200 }) } });

  function resetCreate() {
    setPatientId(""); setNotes(""); setLines([{ bodyPart: "", bodyPartAr: "" }]); setShowArCreate(false);
  }

  const createMutation = useCreateXrayRecord({
    mutation: {
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  async function handleCreate() {
    const items = lines.filter(l => l.bodyPart.trim());
    const missing = [!patientId && t("patient"), !user?.id && t("requestedByDoctor"), !items.length && t("bodyPart")].filter(Boolean);
    if (missing.length) { toast({ title: t("fillRequiredFields"), description: missing.join(", "), variant: "destructive" }); return; }
    const orderGroupId = items.length > 1 ? newOrderGroupId() : undefined;
    try {
      for (const it of items) {
        await createMutation.mutateAsync({ data: { patientId: parseInt(patientId), requestedById: user!.id, bodyPart: it.bodyPart, bodyPartAr: it.bodyPartAr || undefined, notes: notes || undefined, orderGroupId } as any });
      }
      queryClient.invalidateQueries({ queryKey: getListXrayImagesQueryKey() });
      setShowCreate(false);
      resetCreate();
      toast({ title: items.length > 1 ? `${items.length} ${t("xrayRecordsCreated")}` : t("xrayRecordCreated") });
    } catch { /* onError already surfaced the failure */ }
  }

  const updateMutation = useUpdateXrayRecord({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListXrayImagesQueryKey() });
        setExpandedId(null);
        toast({ title: t("xrayUpdated") });
      },
    },
  });

  const allXrays = xrays ?? [];
  const openCount = allXrays.filter(x => x.status === "requested" || x.status === "in_progress").length;

  function openInline(xray: NonNullable<typeof xrays>[number]) {
    if (expandedId === xray.id) { setExpandedId(null); return; }
    const parsed = parseReport(xray.report);
    setFindings(parsed.findings);
    setImpression(parsed.impression);
    setFindingsAr((xray as any).findingsAr || "");
    setImpressionAr((xray as any).impressionAr || "");
    setReportStatus(xray.status);
    setShowArReport(false);
    setExpandedId(xray.id);
  }

  // After an upload/delete: refresh the list and mirror the server-side
  // requested→in_progress auto-advance in the local status control.
  function onImagesChanged() {
    queryClient.invalidateQueries({ queryKey: getListXrayImagesQueryKey() });
    setReportStatus(s => (s === "requested" ? "in_progress" : s));
  }

  async function handlePrint(xray: NonNullable<typeof xrays>[number]) {
    const lang = await choosePrintLang();
    if (!lang) return;
    const imgs = liveImages(xray);
    openPrintWindow(
      xrayReportHtml({
        createdAt: xray.createdAt,
        bodyPart: xray.bodyPart,
        patient: xray.patient as any,
        requestedBy: xray.requestedBy as any,
        findings,
        impression,
        imageUrl: imgs[0]?.url,
        images: imgs,
      }, lang),
      `X-Ray Report - ${xray.bodyPart}`
    );
  }

  function applyTemplate(tpl: ReportTemplate) {
    setFindings(f => f ? `${f}\n${tpl.findings}` : tpl.findings);
    setImpression(i => i ? `${i}\n${tpl.impression}` : tpl.impression);
    if (tpl.findingsAr) { setFindingsAr(a => a ? `${a}\n${tpl.findingsAr}` : tpl.findingsAr!); setShowArReport(true); }
    if (tpl.impressionAr) setImpressionAr(a => a ? `${a}\n${tpl.impressionAr}` : tpl.impressionAr!);
  }

  function saveReport() {
    if (!expandedId) return;
    updateMutation.mutate({ xrayId: expandedId, data: { report: serializeReport(findings, impression), status: reportStatus as any, findingsAr: findingsAr || undefined, impressionAr: impressionAr || undefined } as any });
  }

  const groupCounts = countByOrderGroup(allXrays as any);

  const sortedFiltered = [...allXrays]
    .filter(x => {
      if (!search) return true;
      const q = search.toLowerCase();
      return x.patient?.fullName?.toLowerCase().includes(q) || x.bodyPart?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (filterStatus) return 0;
      const sa = STATUS_SORT_ORDER[a.status] ?? 99;
      const sb = STATUS_SORT_ORDER[b.status] ?? 99;
      return sa - sb;
    });

  return (
    <div className="page">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Input className="h-8 text-sm max-w-xs" placeholder={t("searchByPatientOrBodyPart")} value={search} onChange={e => setSearch(e.target.value)} />
        <Select value={filterStatus || "all"} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 text-sm w-36" data-testid="select-filter-status">
            <SelectValue placeholder={t("all")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            {IMAGING_STATUSES.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
          </SelectContent>
        </Select>
        {openCount > 0 && (
          <span className="badge badge-rose text-[11px]">{openCount} {t("pending")}</span>
        )}
        {/* Any role that can open this page can also order a study (doctor, xray_staff,
            admin) — the create dialog is the request flow; results editing is gated by canEdit. */}
        <button className="btn btn-primary btn-sm gap-1.5 ms-auto" onClick={() => setShowCreate(true)} data-testid="button-create-xray">
          <Plus className="w-3.5 h-3.5" /> {t("newXrayRequest")}
        </button>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          data={sortedFiltered}
          emptyMessage={t("noXrayRecords")}
          onRowClick={openInline}
          expandedRow={expandedId ? (row) => row.id === expandedId ? (
            <div className="p-4 bg-[var(--surface-2)] border-t border-[var(--line)] space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs">
                <div><span className="text-[var(--ink-muted)]">{t("patient")}: </span><span className="font-medium text-[var(--ink)]">{row.patient?.fullName || `#${row.patientId}`}</span></div>
                {row.patient?.mrn && <div><span className="text-[var(--ink-muted)]">{t("mrn")}: </span><span className="font-mono text-[var(--ink)]">{row.patient.mrn}</span></div>}
                {(row.patient as any)?.dateOfBirth && <div><span className="text-[var(--ink-muted)]">{t("dateOfBirth")}: </span><span className="text-[var(--ink)]">{formatDate((row.patient as any).dateOfBirth)}</span></div>}
                {(row.patient as any)?.gender && <div><span className="text-[var(--ink-muted)]">{t("gender")}: </span><span className="text-[var(--ink)] capitalize">{(row.patient as any).gender}</span></div>}
                {row.requestedBy?.fullName && <div><span className="text-[var(--ink-muted)]">{t("requestedBy")}: </span><span className="text-[var(--ink)]">{row.requestedBy.fullName}</span></div>}
              </div>

              {/* Workflow pipeline */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <StatusStepper
                  stages={IMAGING_STATUSES.map(s => ({ value: s, label: t(s as any) }))}
                  current={reportStatus}
                />
                {canEdit && reportStatus !== "completed" && (
                  <button
                    type="button"
                    className="btn btn-outline btn-sm h-7 text-xs"
                    onClick={() => setReportStatus(reportStatus === "requested" ? "in_progress" : "completed")}
                  >
                    {reportStatus === "requested" ? t("markInProgress") : t("markCompleted")}
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs">{t("images")}</Label>
                <ImageUploader modality="xray" recordId={row.id} images={liveImages(row)} canEdit={canEdit} onChanged={onImagesChanged} />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">{t("findings")}</Label>
                  {canEdit && (
                    <Select value="" onValueChange={(id) => { const tpl = xrayTemplates.find(x => x.id === id); if (tpl) applyTemplate(tpl); }}>
                      <SelectTrigger className="h-7 text-xs w-52" data-testid="select-template"><SelectValue placeholder={t("insertTemplate")} /></SelectTrigger>
                      <SelectContent>{xrayTemplates.map(tpl => <SelectItem key={tpl.id} value={tpl.id}>{tpl.label}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                </div>
                <Textarea value={findings} onChange={e => setFindings(e.target.value)} rows={3} placeholder={t("findingsPlaceholder")} disabled={!canEdit} data-testid="input-findings" />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">{t("impressionConclusion")}</Label>
                <Textarea value={impression} onChange={e => setImpression(e.target.value)} rows={2} placeholder={t("impressionPlaceholder")} disabled={!canEdit} data-testid="input-impression" />
              </div>

              {/* Arabic report fields toggle */}
              <button
                type="button"
                className="btn btn-ghost btn-sm h-7 text-xs gap-1.5 text-[var(--ink-muted)] w-full justify-start px-0"
                onClick={() => setShowArReport(v => !v)}
              >
                <span className="text-base leading-none">ع</span> {t("arabicFields")}
              </button>
              {showArReport && (
                <div className="space-y-3 border border-[var(--line)] rounded-lg p-3 bg-[var(--surface-2)]" dir="rtl">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("findingsAr")}</Label>
                    <Textarea value={findingsAr} onChange={e => setFindingsAr(e.target.value)} rows={2} className="text-right" disabled={!canEdit} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("impressionAr")}</Label>
                    <Textarea value={impressionAr} onChange={e => setImpressionAr(e.target.value)} rows={2} className="text-right" disabled={!canEdit} />
                  </div>
                </div>
              )}

              {canEdit && (
                <div className="space-y-1">
                  <Label className="text-xs">{t("status")}</Label>
                  <Select value={reportStatus} onValueChange={setReportStatus}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {IMAGING_STATUSES.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex justify-between gap-2">
                <button
                  className="btn btn-outline btn-sm gap-1.5"
                  onClick={() => handlePrint(row)}
                  disabled={!findings && !impression}
                >
                  <Printer className="w-3.5 h-3.5" /> {t("printReport")}
                </button>
                <div className="flex gap-2">
                  <button className="btn btn-outline btn-sm" onClick={() => setExpandedId(null)}>{canEdit ? t("cancel") : t("close")}</button>
                  {canEdit && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={saveReport}
                      disabled={updateMutation.isPending}
                      data-testid="button-save-report"
                    >
                      {updateMutation.isPending ? t("loading") : t("save")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : null : undefined}
          columns={[
            {
              key: "patient",
              header: t("patient"),
              render: x => (
                <div>
                  <span className="font-medium text-[13px] text-[var(--ink)]">{x.patient?.fullName || `#${x.patientId}`}</span>
                  {x.patient?.mrn && <div className="text-[11px] text-[var(--ink-muted)] font-mono">{x.patient.mrn}</div>}
                </div>
              ),
            },
            { key: "body",      header: t("bodyPart"),    render: x => (
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-medium text-[var(--ink)]">{x.bodyPart}</span>
                {(x as any).orderGroupId && groupCounts[(x as any).orderGroupId] > 1 && (
                  <span className="badge badge-blue text-[10px] gap-0.5" title={t("partOfOrder")}><Layers className="w-2.5 h-2.5" />{groupCounts[(x as any).orderGroupId]}</span>
                )}
              </div>
            ) },
            {
              key: "report",
              header: t("reportSummary"),
              render: x => {
                const { findings: f, impression: imp } = parseReport(x.report);
                if (!f && !imp) return <span className="text-[11px] text-[var(--ink-faint)]">{t("noReportYet")}</span>;
                return (
                  <div className="text-xs space-y-0.5">
                    {f && <p className="text-[var(--ink-muted)] line-clamp-1"><span className="font-medium text-[var(--ink)]">{t("findings")}:</span> {f}</p>}
                    {imp && <p className="text-[var(--ink-muted)] line-clamp-1"><span className="font-medium text-[var(--ink)]">{t("impression")}:</span> {imp}</p>}
                  </div>
                );
              },
            },
            { key: "requested", header: t("requestedBy"), render: x => <span className="text-[13px] text-[var(--ink)]">{x.requestedBy?.fullName || `#${x.requestedById}`}</span> },
            { key: "date",      header: t("date"),         render: x => <span className="text-[12px] text-[var(--ink-muted)]">{formatDate(x.createdAt)}</span> },
            { key: "status",    header: t("status"),       render: x => <StatusBadge status={x.status} /> },
            {
              key: "actions",
              header: t("actions"),
              render: x => (
                <button
                  className={cn("btn btn-sm h-6 text-xs px-2 gap-1", expandedId === x.id ? "btn-primary" : "btn-outline")}
                  onClick={e => { e.stopPropagation(); openInline(x); }}
                  data-testid={`button-report-${x.id}`}
                >
                  <FileImage className="w-3 h-3" />
                  {expandedId === x.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              ),
            },
          ]}
        />
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("newXrayRequest")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("patient")} *</Label>
              <PatientSearchSelect
                testId="select-patient"
                value={patientId}
                onChange={setPatientId}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("requestedByDoctor")} *</Label>
              {/* Requester is locked to the signed-in user — not selectable, for any role. */}
              <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3 text-sm text-[var(--ink)]">
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--teal-600)] flex-shrink-0" />
                <span className="truncate">{user?.fullName}</span>
                <span className="text-[var(--ink-muted)] text-xs">({t("you")})</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{t("bodyParts")} *</Label>
                {lines.length > 1 && <span className="badge badge-blue text-[10px] gap-0.5"><Layers className="w-2.5 h-2.5" />{lines.length}</span>}
              </div>
              {lines.map((ln, i) => (
                <div key={i} className="space-y-1 rounded-md border border-[var(--line)] p-2">
                  <div className="flex gap-2 items-center">
                    <Input value={ln.bodyPart} onChange={e => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, bodyPart: e.target.value } : l))} placeholder={t("egXrBodyPart")} data-testid={`input-body-part-${i}`} className="h-8 text-sm" />
                    <button type="button" className="btn btn-ghost btn-sm h-8 w-8 p-0 text-[var(--ink-muted)] hover:text-[var(--rose-500)] flex-shrink-0" onClick={() => setLines(ls => ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i))} disabled={lines.length === 1} aria-label={t("remove")}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  {showArCreate && (
                    <Input value={ln.bodyPartAr} onChange={e => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, bodyPartAr: e.target.value } : l))} placeholder={t("bodyPartAr")} className="h-8 text-sm text-right" dir="rtl" />
                  )}
                </div>
              ))}
              <button type="button" className="btn btn-outline btn-sm h-7 text-xs gap-1" onClick={() => setLines(ls => [...ls, { bodyPart: "", bodyPartAr: "" }])} data-testid="button-add-bodypart">
                <Plus className="w-3 h-3" /> {t("addAnother")}
              </button>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm h-7 text-xs gap-1.5 text-[var(--ink-muted)] w-full justify-start px-0"
              onClick={() => setShowArCreate(v => !v)}
            >
              <span className="text-base leading-none">ع</span> {t("arabicFields")}
            </button>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleCreate}
                disabled={createMutation.isPending}
                data-testid="button-save-xray"
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
