import { useState } from "react";
import { useListXrayImages, useCreateXrayRecord, useUpdateXrayRecord, useListPatients, useListUsers, getListXrayImagesQueryKey, getListPatientsQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { openPrintWindow, xrayReportHtml } from "@/lib/print";
import { Plus, FileImage, Printer, ChevronDown, ChevronUp } from "lucide-react";

const STATUS_SORT_ORDER: Record<string, number> = { pending: 0, uploaded: 1, reviewed: 2 };

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif)(\?.*)?$/i;

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

export default function XRay() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ patientId: "", requestedById: "", bodyPart: "", notes: "" });

  // Inline expand state
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [findings, setFindings] = useState("");
  const [impression, setImpression] = useState("");
  const [reportStatus, setReportStatus] = useState("uploaded");

  const filterParams = { status: filterStatus as any || undefined };
  const { data: xrays, isLoading } = useListXrayImages(filterParams, { query: { queryKey: getListXrayImagesQueryKey(filterParams) } });
  const { data: patients } = useListPatients({ limit: 200, offset: 0 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200, offset: 0 }) } });
  const { data: doctors } = useListUsers({ role: "doctor" as any }, { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } });

  const createMutation = useCreateXrayRecord({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListXrayImagesQueryKey() });
        setShowCreate(false);
        setForm({ patientId: "", requestedById: "", bodyPart: "", notes: "" });
        toast({ title: "X-ray record created" });
      },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    }
  });

  const updateMutation = useUpdateXrayRecord({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListXrayImagesQueryKey() });
        setExpandedId(null);
        toast({ title: "X-ray updated" });
      },
    }
  });

  const statuses = ["pending", "uploaded", "reviewed"];
  const allXrays = xrays ?? [];
  const pendingCount = allXrays.filter(x => x.status === "pending" || x.status === "uploaded").length;

  function openInline(xray: NonNullable<typeof xrays>[number]) {
    if (expandedId === xray.id) { setExpandedId(null); return; }
    const parsed = parseReport(xray.report);
    setFindings(parsed.findings);
    setImpression(parsed.impression);
    setImageUrl(xray.imageUrl || "");
    setReportStatus(xray.status);
    setExpandedId(xray.id);
  }

  function handlePrint() {
    const xray = allXrays.find(x => x.id === expandedId);
    if (!xray) return;
    openPrintWindow(
      xrayReportHtml({
        createdAt: xray.createdAt,
        bodyPart: xray.bodyPart,
        patient: xray.patient as any,
        requestedBy: xray.requestedBy as any,
        findings,
        impression,
        imageUrl,
      }),
      `X-Ray Report - ${xray.bodyPart}`
    );
  }

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
    <div>
      <PageHeader
        title={t("xray")}
        subtitle={
          <span className="flex items-center gap-2">
            {allXrays.length} records
            {pendingCount > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                {pendingCount} pending
              </Badge>
            )}
          </span>
        }
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-xray">
            <Plus className="w-3.5 h-3.5 me-1" /> New X-Ray Request
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-3 mb-4">
          <Input className="h-8 text-sm max-w-xs" placeholder="Search by patient or body part…" value={search} onChange={e => setSearch(e.target.value)} />
          <Select value={filterStatus || "all"} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm w-36" data-testid="select-filter-status"><SelectValue placeholder={t("all")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("all")}</SelectItem>
              {statuses.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={sortedFiltered}
            emptyMessage="No X-ray records"
            expandedRow={expandedId ? (row) => row.id === expandedId ? (
              <div className="p-4 bg-muted/30 border-t border-border space-y-4">
                <div className="space-y-1">
                  <Label className="text-xs">Image URL</Label>
                  <Input value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="https://…" data-testid="input-image-url" />
                  {imageUrl && IMAGE_EXT_RE.test(imageUrl) && (
                    <div className="mt-2">
                      <img
                        src={imageUrl}
                        alt="X-ray preview"
                        loading="lazy"
                        className="h-32 rounded border border-border object-cover"
                        onError={e => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                          if (fallback) fallback.style.display = "block";
                        }}
                      />
                      <p className="hidden text-xs text-muted-foreground mt-1">Preview unavailable</p>
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Findings</Label>
                  <Textarea value={findings} onChange={e => setFindings(e.target.value)} rows={3} placeholder="Describe the radiological findings observed…" data-testid="input-findings" />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Impression / Conclusion</Label>
                  <Textarea value={impression} onChange={e => setImpression(e.target.value)} rows={2} placeholder="Radiologist's impression and clinical conclusion…" data-testid="input-impression" />
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">{t("status")}</Label>
                  <Select value={reportStatus} onValueChange={setReportStatus}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="uploaded">Uploaded</SelectItem>
                      <SelectItem value="reviewed">Reviewed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex justify-between gap-2">
                  <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1" disabled={!findings && !impression}>
                    <Printer className="w-3.5 h-3.5" /> Print Report
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setExpandedId(null)}>{t("cancel")}</Button>
                    <Button size="sm" onClick={() => expandedId && updateMutation.mutate({ xrayId: expandedId, data: { report: serializeReport(findings, impression), imageUrl: imageUrl || undefined, status: reportStatus as any } })} disabled={updateMutation.isPending} data-testid="button-save-report">
                      {updateMutation.isPending ? t("loading") : t("save")}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null : undefined}
            columns={[
              { key: "patient", header: "Patient", render: x => (
                <div>
                  <span className="font-medium text-sm">{x.patient?.fullName || `#${x.patientId}`}</span>
                  {x.patient?.mrn && <div className="text-xs text-muted-foreground font-mono">{x.patient.mrn}</div>}
                </div>
              )},
              { key: "body", header: t("bodyPart"), render: x => <span className="text-sm font-medium">{x.bodyPart}</span> },
              { key: "report", header: "Report Summary", render: x => {
                const { findings: f, impression: imp } = parseReport(x.report);
                if (!f && !imp) return <span className="text-xs text-muted-foreground">No report yet</span>;
                return (
                  <div className="text-xs space-y-0.5">
                    {f && <p className="text-muted-foreground line-clamp-1"><span className="font-medium text-foreground">Findings:</span> {f}</p>}
                    {imp && <p className="text-muted-foreground line-clamp-1"><span className="font-medium text-foreground">Impression:</span> {imp}</p>}
                  </div>
                );
              }},
              { key: "requested", header: "Requested By", render: x => <span className="text-sm">{x.requestedBy?.fullName || `#${x.requestedById}`}</span> },
              { key: "date", header: t("date"), render: x => <span className="text-sm">{formatDate(x.createdAt)}</span> },
              { key: "status", header: t("status"), render: x => <StatusBadge status={x.status} /> },
              { key: "actions", header: t("actions"), render: x => (
                <Button size="sm" variant={expandedId === x.id ? "default" : "outline"} className="h-6 text-xs px-2" onClick={(e) => { e.stopPropagation(); openInline(x); }} data-testid={`button-report-${x.id}`}>
                  <FileImage className="w-3 h-3 me-1" />
                  {expandedId === x.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </Button>
              )},
            ]}
          />
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New X-Ray Request</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Patient *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
                <SelectContent>{patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Requested By (Doctor) *</Label>
              <Select value={form.requestedById} onValueChange={v => setForm(f => ({ ...f, requestedById: v }))}>
                <SelectTrigger><SelectValue placeholder="Select doctor" /></SelectTrigger>
                <SelectContent>{doctors?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("bodyPart")} *</Label>
              <Input value={form.bodyPart} onChange={e => setForm(f => ({ ...f, bodyPart: e.target.value }))} placeholder="e.g. Chest, Left Hand..." data-testid="input-body-part" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ data: { patientId: parseInt(form.patientId), requestedById: parseInt(form.requestedById), bodyPart: form.bodyPart, notes: form.notes || undefined } as any })} disabled={createMutation.isPending} data-testid="button-save-xray">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
