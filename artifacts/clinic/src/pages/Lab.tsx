import { useState } from "react";
import { useListLabTests, useCreateLabTest, useUpdateLabTest, useListPatients, useListUsers, getListLabTestsQueryKey, getListPatientsQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
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
import { openPrintWindow, labReportHtml, type LabParam } from "@/lib/print";
import { Plus, ClipboardList, Trash2, Printer, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const COMMON_TESTS = ["CBC", "Lipid Panel", "HbA1c", "Blood Glucose", "Liver Function", "Kidney Function", "Thyroid Panel", "Urinalysis", "Coagulation Panel"];

const STATUS_SORT_ORDER: Record<string, number> = { requested: 0, in_progress: 1, completed: 2, cancelled: 3 };

function parseResults(raw: string | null | undefined): { params: LabParam[]; notes: string } {
  if (!raw) return { params: [], notes: "" };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.v === 1) return { params: parsed.params ?? [], notes: parsed.notes ?? "" };
  } catch { /* plain text */ }
  return { params: [], notes: raw };
}

function serializeResults(params: LabParam[], notes: string): string {
  return JSON.stringify({ v: 1, params, notes });
}

const emptyParam = (): LabParam => ({ name: "", value: "", unit: "", refRange: "", flag: "" });

export default function Lab() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({ patientId: "", requestedById: "", testName: "", notes: "" });

  // Inline expand state (replaces dialog for result entry)
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [inlineParams, setInlineParams] = useState<LabParam[]>([emptyParam()]);
  const [inlineNotes, setInlineNotes] = useState("");
  const [inlineStatus, setInlineStatus] = useState("completed");

  const filterParams = { status: filterStatus as any || undefined };
  const { data: tests, isLoading } = useListLabTests(filterParams, { query: { queryKey: getListLabTestsQueryKey(filterParams) } });
  const { data: patients } = useListPatients({ limit: 200, offset: 0 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200, offset: 0 }) } });
  const { data: doctors } = useListUsers({ role: "doctor" as any }, { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } });

  const createMutation = useCreateLabTest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLabTestsQueryKey() });
        setShowCreate(false);
        setForm({ patientId: "", requestedById: "", testName: "", notes: "" });
        toast({ title: "Lab test created" });
      },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    }
  });

  const updateMutation = useUpdateLabTest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLabTestsQueryKey() });
        setExpandedId(null);
        toast({ title: "Lab results saved" });
      },
    }
  });

  const statuses = ["requested", "in_progress", "completed", "cancelled"];

  function openInline(test: NonNullable<typeof tests>[number]) {
    if (expandedId === test.id) { setExpandedId(null); return; }
    const parsed = parseResults(test.results);
    setInlineParams(parsed.params.length ? parsed.params : [emptyParam()]);
    setInlineNotes(parsed.notes);
    setInlineStatus(test.status);
    setExpandedId(test.id);
  }

  function updateParam(i: number, field: keyof LabParam, val: string) {
    setInlineParams(ps => ps.map((p, idx) => idx === i ? { ...p, [field]: val } : p));
  }

  function handlePrint(test: NonNullable<typeof tests>[number]) {
    openPrintWindow(
      labReportHtml({
        createdAt: test.createdAt,
        testName: test.testName,
        patient: test.patient as any,
        requestedBy: test.requestedBy as any,
        params: inlineParams,
        notes: inlineNotes,
      }),
      `Lab Report - ${test.testName}`
    );
  }

  const flagColor = (flag: string) =>
    flag === "H" ? "text-red-600 font-bold" : flag === "L" ? "text-blue-600 font-bold" : "text-green-700";

  const allTests = tests ?? [];
  const pendingCount = allTests.filter(t => t.status === "requested" || t.status === "in_progress").length;

  const sortedFiltered = [...allTests]
    .filter(t => {
      if (!search) return true;
      const q = search.toLowerCase();
      return t.patient?.fullName?.toLowerCase().includes(q) || t.testName?.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      if (filterStatus) return 0; // user picked a specific status — respect backend order
      const sa = STATUS_SORT_ORDER[a.status] ?? 99;
      const sb = STATUS_SORT_ORDER[b.status] ?? 99;
      return sa - sb;
    });

  return (
    <div>
      <PageHeader
        title={t("lab")}
        subtitle={
          <span className="flex items-center gap-2">
            {allTests.length} tests
            {pendingCount > 0 && (
              <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                {pendingCount} pending
              </Badge>
            )}
          </span>
        }
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-lab">
            <Plus className="w-3.5 h-3.5 me-1" /> Request Test
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-3 mb-4">
          <Input className="h-8 text-sm max-w-xs" placeholder="Search by patient or test name…" value={search} onChange={e => setSearch(e.target.value)} />
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
            emptyMessage="No lab tests"
            expandedRow={expandedId ? (row) => row.id === expandedId ? (
              <div className="p-4 bg-muted/30 border-t border-border space-y-4">
                {/* Parameter grid */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs">Test Parameters</Label>
                    <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={() => setInlineParams(ps => [...ps, emptyParam()])}>
                      <Plus className="w-3 h-3 me-1" /> Add Row
                    </Button>
                  </div>
                  <div className="border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Parameter</th>
                          <th className="text-left px-2 py-1.5 font-medium text-muted-foreground w-24">Value</th>
                          <th className="text-left px-2 py-1.5 font-medium text-muted-foreground w-20">Unit</th>
                          <th className="text-left px-2 py-1.5 font-medium text-muted-foreground w-28">Ref Range</th>
                          <th className="text-center px-2 py-1.5 font-medium text-muted-foreground w-16">Flag</th>
                          <th className="w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {inlineParams.map((p, i) => (
                          <tr key={i} className={cn("border-t border-border/50", p.flag === "H" ? "bg-red-50/50" : p.flag === "L" ? "bg-blue-50/50" : "")}>
                            <td className="px-1 py-1">
                              <Input value={p.name} onChange={e => updateParam(i, "name", e.target.value)} className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1" placeholder="e.g. Hemoglobin" />
                            </td>
                            <td className="px-1 py-1">
                              <Input value={p.value} onChange={e => updateParam(i, "value", e.target.value)} className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1 w-24" placeholder="12.5" />
                            </td>
                            <td className="px-1 py-1">
                              <Input value={p.unit} onChange={e => updateParam(i, "unit", e.target.value)} className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1 w-20" placeholder="g/dL" />
                            </td>
                            <td className="px-1 py-1">
                              <Input value={p.refRange} onChange={e => updateParam(i, "refRange", e.target.value)} className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1 w-28" placeholder="12.0-16.0" />
                            </td>
                            <td className="px-1 py-1 text-center">
                              <Select value={p.flag || "N"} onValueChange={v => updateParam(i, "flag", v === "N" ? "" : v)}>
                                <SelectTrigger className={cn("h-7 text-xs w-14 mx-auto", p.flag === "H" ? "text-red-600 font-bold" : p.flag === "L" ? "text-blue-600 font-bold" : "text-green-700")}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="N"><span className="text-green-700">N</span></SelectItem>
                                  <SelectItem value="H"><span className="text-red-600 font-bold">H</span></SelectItem>
                                  <SelectItem value="L"><span className="text-blue-600 font-bold">L</span></SelectItem>
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="px-1 py-1">
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => setInlineParams(ps => ps.filter((_, j) => j !== i))} disabled={inlineParams.length === 1}>
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">H = High · L = Low · N = Normal</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Notes / Interpretation</Label>
                  <Textarea value={inlineNotes} onChange={e => setInlineNotes(e.target.value)} rows={2} placeholder="Any additional notes…" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">{t("status")}</Label>
                  <Select value={inlineStatus} onValueChange={setInlineStatus}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {statuses.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-between gap-2">
                  <Button variant="outline" size="sm" onClick={() => { const t = sortedFiltered.find(x => x.id === expandedId); if (t) handlePrint(t); }} className="gap-1" disabled={!inlineParams.some(p => p.value)}>
                    <Printer className="w-3.5 h-3.5" /> Print
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setExpandedId(null)}>{t("cancel")}</Button>
                    <Button size="sm" onClick={() => expandedId && updateMutation.mutate({ testId: expandedId, data: { results: serializeResults(inlineParams, inlineNotes), status: inlineStatus as any } })} disabled={updateMutation.isPending} data-testid="button-save-results">
                      {updateMutation.isPending ? t("loading") : t("save")}
                    </Button>
                  </div>
                </div>
              </div>
            ) : null : undefined}
            columns={[
              { key: "patient", header: "Patient", render: l => (
                <div>
                  <span className="font-medium text-sm">{l.patient?.fullName || `#${l.patientId}`}</span>
                  {l.patient?.mrn && <div className="text-xs text-muted-foreground font-mono">{l.patient.mrn}</div>}
                </div>
              )},
              { key: "test", header: t("testName"), render: l => <span className="text-sm font-medium">{l.testName}</span> },
              { key: "requested", header: "Requested By", render: l => <span className="text-sm">{l.requestedBy?.fullName || `#${l.requestedById}`}</span> },
              { key: "results", header: "Results", render: l => {
                const { params: ps } = parseResults(l.results);
                if (!ps.length) return <span className="text-xs text-muted-foreground">—</span>;
                const abnormal = ps.filter(p => p.flag === "H" || p.flag === "L");
                return (
                  <div className="text-xs space-y-0.5">
                    {ps.slice(0, 2).map((p, i) => (
                      <div key={i} className="flex gap-1">
                        <span className="text-muted-foreground">{p.name}:</span>
                        <span className={cn("font-medium", p.flag === "H" ? "text-red-600" : p.flag === "L" ? "text-blue-600" : "")}>{p.value} {p.unit}</span>
                        {p.flag && <span className={flagColor(p.flag)}>{p.flag}</span>}
                      </div>
                    ))}
                    {ps.length > 2 && <span className="text-muted-foreground">+{ps.length - 2} more</span>}
                    {abnormal.length > 0 && <div className="text-red-600 text-[10px] font-semibold">{abnormal.length} abnormal</div>}
                  </div>
                );
              }},
              { key: "date", header: t("date"), render: l => <span className="text-sm">{formatDate(l.createdAt)}</span> },
              { key: "status", header: t("status"), render: l => <StatusBadge status={l.status} /> },
              { key: "actions", header: t("actions"), render: l => (
                <Button size="sm" variant={expandedId === l.id ? "default" : "outline"} className="h-6 text-xs px-2" onClick={(e) => { e.stopPropagation(); openInline(l); }} data-testid={`button-results-${l.id}`}>
                  <ClipboardList className="w-3 h-3 me-1" />
                  {expandedId === l.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </Button>
              )},
            ]}
          />
        </div>
      </div>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Request Lab Test</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Patient *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select patient" /></SelectTrigger>
                <SelectContent>{patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Requested By *</Label>
              <Select value={form.requestedById} onValueChange={v => setForm(f => ({ ...f, requestedById: v }))}>
                <SelectTrigger><SelectValue placeholder="Select doctor" /></SelectTrigger>
                <SelectContent>{doctors?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("testName")} *</Label>
              <Input value={form.testName} onChange={e => setForm(f => ({ ...f, testName: e.target.value }))} placeholder="CBC, Lipid Panel, HbA1c..." list="common-tests" data-testid="input-test-name" />
              <datalist id="common-tests">{COMMON_TESTS.map(n => <option key={n} value={n} />)}</datalist>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ data: { patientId: parseInt(form.patientId), requestedById: parseInt(form.requestedById), testName: form.testName, notes: form.notes || undefined } as any })} disabled={createMutation.isPending} data-testid="button-save-lab">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
