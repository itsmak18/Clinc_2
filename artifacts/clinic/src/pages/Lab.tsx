import { useState, useEffect } from "react";
import { useListLabTests, useCreateLabTest, useUpdateLabTest, useListPatients, getListLabTestsQueryKey, getListPatientsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import ClearanceChip from "@/components/ClearanceChip";
import OverrideClearanceDialog from "@/components/OverrideClearanceDialog";
import PatientSearchSelect from "@/components/PatientSearchSelect";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { openPrintWindow, labReportHtml, type LabParam } from "@/lib/print";
import { usePrintLang } from "@/hooks/printLang";
import { newOrderGroupId, countByOrderGroup } from "@/lib/ids";
import { Plus, ClipboardList, Trash2, Printer, ChevronDown, ChevronUp, ShieldCheck, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { isClearanceLocked, canOverrideClearance, CLEARANCE_QUEUE_TABS } from "@/lib/clearance";

const COMMON_TESTS = ["CBC", "Lipid Panel", "HbA1c", "Blood Glucose", "Liver Function", "Kidney Function", "Thyroid Panel", "Urinalysis", "Coagulation Panel"];

const STATUS_SORT_ORDER: Record<string, number> = { requested: 0, in_progress: 1, completed: 2, cancelled: 3 };

// Only lab staff (and admins) fill/verify results. Doctors request tests and read
// results, but cannot edit values or change status — mirrors X-Ray/Ultrasound.
const EDIT_ROLES = ["super_admin", "admin", "lab_staff"];


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
  const choosePrintLang = usePrintLang();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const canEdit = EDIT_ROLES.includes(user?.role ?? "");
  const [showCreate, setShowCreate] = useState(false);
  const [filterStatus, setFilterStatus] = useState("");
  const [clearanceTab, setClearanceTab] = useState("");
  const [search, setSearch] = useState("");
  const [showArCreate, setShowArCreate] = useState(false);
  // Create dialog: shared patient + notes, plus one line per test (multi-add).
  const [patientId, setPatientId] = useState("");
  const [notes, setNotes] = useState("");
  const [notesAr, setNotesAr] = useState("");

  // Deep-link from the patient page (/lab?patientId=N): open the create dialog
  // pre-filled for that patient.
  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get("patientId");
    if (pid) { setPatientId(pid); setShowCreate(true); }
  }, []);
  const [lines, setLines] = useState<{ testName: string; testNameAr: string }[]>([{ testName: "", testNameAr: "" }]);

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [overrideInvoiceId, setOverrideInvoiceId] = useState<number | null>(null);
  const [inlineParams, setInlineParams] = useState<LabParam[]>([emptyParam()]);
  const [inlineNotes, setInlineNotes] = useState("");
  const [inlineStatus, setInlineStatus] = useState("completed");

  const filterParams = { status: filterStatus as any || undefined, clearanceStatus: clearanceTab || undefined };
  const { data: tests, isLoading } = useListLabTests(filterParams, { query: { queryKey: getListLabTestsQueryKey(filterParams) } });
  const { data: patients } = useListPatients({ limit: 200 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200 }) } });

  function resetCreate() {
    setPatientId(""); setNotes(""); setNotesAr(""); setLines([{ testName: "", testNameAr: "" }]); setShowArCreate(false);
  }

  const createMutation = useCreateLabTest({
    mutation: {
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  async function handleCreate() {
    const items = lines.filter(l => l.testName.trim());
    const missing = [!patientId && t("patient"), !user?.id && t("requestedBy"), !items.length && t("testName")].filter(Boolean);
    if (missing.length) { toast({ title: t("fillRequiredFields"), description: missing.join(", "), variant: "destructive" }); return; }
    const orderGroupId = items.length > 1 ? newOrderGroupId() : undefined;
    try {
      for (const it of items) {
        await createMutation.mutateAsync({ data: { patientId: parseInt(patientId), requestedById: user!.id, testName: it.testName, testNameAr: it.testNameAr || undefined, notes: notes || undefined, notesAr: notesAr || undefined, orderGroupId } as any });
      }
      queryClient.invalidateQueries({ queryKey: getListLabTestsQueryKey() });
      setShowCreate(false);
      resetCreate();
      toast({ title: items.length > 1 ? `${items.length} ${t("labTestsCreated")}` : t("labTestCreated") });
    } catch { /* onError already surfaced the failure */ }
  }

  const updateMutation = useUpdateLabTest({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListLabTestsQueryKey() });
        setExpandedId(null);
        toast({ title: t("labResultsSaved") });
      },
    },
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

  async function handlePrint(test: NonNullable<typeof tests>[number]) {
    const lang = await choosePrintLang();
    if (!lang) return;
    openPrintWindow(
      labReportHtml({
        createdAt: test.createdAt,
        testName: test.testName,
        patient: test.patient as any,
        requestedBy: test.requestedBy as any,
        params: inlineParams,
        notes: inlineNotes,
      }, lang),
      `Lab Report - ${test.testName}`
    );
  }

  const flagColor = (flag: string) =>
    flag === "H" ? "text-[var(--rose-600)] font-bold" : flag === "L" ? "text-blue-600 font-bold" : "text-[var(--teal-700)]";

  const allTests = tests ?? [];
  const groupCounts = countByOrderGroup(allTests as any);
  const pendingCount = allTests.filter(t => t.status === "requested" || t.status === "in_progress").length;

  const sortedFiltered = [...allTests]
    .filter(t => {
      if (!search) return true;
      const q = search.toLowerCase();
      return t.patient?.fullName?.toLowerCase().includes(q) || t.testName?.toLowerCase().includes(q);
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
        <Input className="h-8 text-sm max-w-xs" placeholder={t("searchByPatientOrTest")} value={search} onChange={e => setSearch(e.target.value)} />
        <Select value={filterStatus || "all"} onValueChange={v => setFilterStatus(v === "all" ? "" : v)}>
          <SelectTrigger className="h-8 text-sm w-36" data-testid="select-filter-status">
            <SelectValue placeholder={t("all")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("all")}</SelectItem>
            {statuses.map(s => <SelectItem key={s} value={s}>{t(s as any)}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* Payment-clearance queue tabs (visibility plan): default All — the
            guard blocks unpaid work regardless; tabs only focus the view. */}
        <div className="flex items-center gap-1" role="tablist" aria-label={t("awaitingPayment")}>
          {CLEARANCE_QUEUE_TABS.map(tab => (
            <button
              key={tab.value}
              role="tab"
              aria-selected={clearanceTab === tab.value}
              className={cn("btn btn-sm h-8 text-xs px-2.5", clearanceTab === tab.value ? "btn-primary" : "btn-outline")}
              onClick={() => setClearanceTab(tab.value)}
              data-testid={`tab-clearance-${tab.value || "all"}`}
            >
              {t(tab.labelKey as any)}
            </button>
          ))}
        </div>
        {pendingCount > 0 && (
          <span className="badge badge-rose text-[11px]">{pendingCount} {t("pending")}</span>
        )}
        <button className="btn btn-primary btn-sm gap-1.5 ms-auto" onClick={() => setShowCreate(true)} data-testid="button-create-lab">
          <Plus className="w-3.5 h-3.5" /> {t("requestTest")}
        </button>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          data={sortedFiltered}
          emptyMessage={t("noLabTests")}
          onRowClick={openInline}
          expandedRow={expandedId ? (row) => row.id === expandedId ? (
            <div className="p-4 bg-[var(--surface-2)] border-t border-[var(--line)] space-y-4">
              <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs">
                <div><span className="text-[var(--ink-muted)]">{t("patient")}: </span><span className="font-medium text-[var(--ink)]">{row.patient?.fullName || `#${row.patientId}`}</span></div>
                {row.patient?.mrn && <div><span className="text-[var(--ink-muted)]">{t("mrn")}: </span><span className="font-mono text-[var(--ink)]">{row.patient.mrn}</span></div>}
                {(row.patient as any)?.dateOfBirth && <div><span className="text-[var(--ink-muted)]">{t("dateOfBirth")}: </span><span className="text-[var(--ink)]">{formatDate((row.patient as any).dateOfBirth)}</span></div>}
                {(row.patient as any)?.gender && <div><span className="text-[var(--ink-muted)]">{t("gender")}: </span><span className="text-[var(--ink)] capitalize">{(row.patient as any).gender}</span></div>}
                {row.requestedBy?.fullName && <div><span className="text-[var(--ink-muted)]">{t("requestedBy")}: </span><span className="text-[var(--ink)]">{row.requestedBy.fullName}</span></div>}
                <ClearanceChip status={(row as any).clearanceStatus} charge={(row as any).charge} />
                {(row as any).clearanceStatus === "pending" && (row as any).invoiceId && canOverrideClearance(user?.role) && (
                  <button
                    className="btn btn-outline btn-sm h-6 text-xs px-2 gap-1"
                    onClick={() => setOverrideInvoiceId((row as any).invoiceId)}
                    data-testid={`button-override-${row.id}`}
                  >
                    {t("emergencyOverride")}
                  </button>
                )}
              </div>
              {/* Parameter grid */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs">{t("testParameters")}</Label>
                  {canEdit && (
                    <button className="btn btn-outline btn-sm h-6 text-xs px-2 gap-1" onClick={() => setInlineParams(ps => [...ps, emptyParam()])}>
                      <Plus className="w-3 h-3" /> {t("addRow")}
                    </button>
                  )}
                </div>
                <div className="border border-[var(--line)] rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-[var(--surface-2)]">
                      <tr>
                        <th className="text-start px-2 py-1.5 font-medium text-[var(--ink-muted)]">{t("parameter")}</th>
                        <th className="text-start px-2 py-1.5 font-medium text-[var(--ink-muted)] w-24">{t("value")}</th>
                        <th className="text-start px-2 py-1.5 font-medium text-[var(--ink-muted)] w-20">{t("unit")}</th>
                        <th className="text-start px-2 py-1.5 font-medium text-[var(--ink-muted)] w-28">{t("refRange")}</th>
                        <th className="text-center px-2 py-1.5 font-medium text-[var(--ink-muted)] w-16">{t("flag")}</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {inlineParams.map((p, i) => (
                        <tr key={i} className={cn("border-t border-[var(--line)]", p.flag === "H" ? "bg-[var(--rose-50)]" : p.flag === "L" ? "bg-blue-50/50" : "")}>
                          <td className="px-1 py-1">
                            <Input value={p.name} onChange={e => updateParam(i, "name", e.target.value)} className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1" placeholder={t("egLabParamName")} disabled={!canEdit} />
                          </td>
                          <td className="px-1 py-1">
                            <Input value={p.value} onChange={e => updateParam(i, "value", e.target.value)} className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1 w-24" placeholder="12.5" disabled={!canEdit} />
                          </td>
                          <td className="px-1 py-1">
                            <Input value={p.unit} onChange={e => updateParam(i, "unit", e.target.value)} className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1 w-20" placeholder="g/dL" disabled={!canEdit} />
                          </td>
                          <td className="px-1 py-1">
                            <Input value={p.refRange} onChange={e => updateParam(i, "refRange", e.target.value)} className="h-7 text-xs border-0 bg-transparent focus-visible:ring-1 px-1 w-28" placeholder="12.0-16.0" disabled={!canEdit} />
                          </td>
                          <td className="px-1 py-1 text-center">
                            <Select value={p.flag || "N"} onValueChange={v => updateParam(i, "flag", v === "N" ? "" : v)} disabled={!canEdit}>
                              <SelectTrigger className={cn("h-7 text-xs w-14 mx-auto", p.flag === "H" ? "text-[var(--rose-600)] font-bold" : p.flag === "L" ? "text-blue-600 font-bold" : "text-[var(--teal-700)]")}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="N"><span className="text-[var(--teal-700)]">N</span></SelectItem>
                                <SelectItem value="H"><span className="text-[var(--rose-600)] font-bold">H</span></SelectItem>
                                <SelectItem value="L"><span className="text-blue-600 font-bold">L</span></SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-1 py-1">
                            <button
                              className="btn btn-ghost btn-sm h-6 w-6 p-0 text-[var(--ink-muted)] hover:text-[var(--rose-500)]"
                              onClick={() => setInlineParams(ps => ps.filter((_, j) => j !== i))}
                              disabled={inlineParams.length === 1 || !canEdit}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-[var(--ink-muted)] mt-1">H = {t("high")} · L = {t("low")} · N = {t("normal")}</p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("notesInterpretation")}</Label>
                <Textarea value={inlineNotes} onChange={e => setInlineNotes(e.target.value)} rows={2} placeholder={t("additionalNotes")} disabled={!canEdit} />
              </div>
              {canEdit && (
                <div className="space-y-1">
                  <Label className="text-xs">{t("status")}</Label>
                  <Select value={inlineStatus} onValueChange={setInlineStatus}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {statuses.map(s => (
                        // While clearance-locked only "cancelled" is actionable —
                        // the backend rejects progress with CLEARANCE_REQUIRED.
                        <SelectItem key={s} value={s} disabled={isClearanceLocked(row as any) && s !== "cancelled" && s !== row.status}>
                          {t(s as any)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <button
                  className="btn btn-outline btn-sm gap-1.5"
                  onClick={() => { const test = sortedFiltered.find(x => x.id === expandedId); if (test) handlePrint(test); }}
                  disabled={!inlineParams.some(p => p.value)}
                >
                  <Printer className="w-3.5 h-3.5" /> {t("print")}
                </button>
                <div className="flex gap-2">
                  <button className="btn btn-outline btn-sm" onClick={() => setExpandedId(null)}>{canEdit ? t("cancel") : t("close")}</button>
                  {canEdit && (
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => expandedId && updateMutation.mutate({ testId: expandedId, data: { results: serializeResults(inlineParams, inlineNotes), status: inlineStatus as any } })}
                      disabled={updateMutation.isPending}
                      data-testid="button-save-results"
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
              render: l => (
                <div>
                  <span className="font-medium text-[13px] text-[var(--ink)]">{l.patient?.fullName || `#${l.patientId}`}</span>
                  {l.patient?.mrn && <div className="text-[11px] text-[var(--ink-muted)] font-mono">{l.patient.mrn}</div>}
                </div>
              ),
            },
            { key: "test",      header: t("testName"),     render: l => (
              <div className="flex items-center gap-1.5">
                <span className="text-[13px] font-medium text-[var(--ink)]">{l.testName}</span>
                {(l as any).orderGroupId && groupCounts[(l as any).orderGroupId] > 1 && (
                  <span className="badge badge-blue text-[10px] gap-0.5" title={t("partOfOrder")}><Layers className="w-2.5 h-2.5" />{groupCounts[(l as any).orderGroupId]}</span>
                )}
              </div>
            ) },
            { key: "requested", header: t("requestedBy"),  render: l => <span className="text-[13px] text-[var(--ink)]">{l.requestedBy?.fullName || `#${l.requestedById}`}</span> },
            {
              key: "results",
              header: t("results"),
              render: l => {
                const { params: ps } = parseResults(l.results);
                if (!ps.length) return <span className="text-[11px] text-[var(--ink-faint)]">—</span>;
                const abnormal = ps.filter(p => p.flag === "H" || p.flag === "L");
                return (
                  <div className="text-xs space-y-0.5">
                    {ps.slice(0, 2).map((p, i) => (
                      <div key={i} className="flex gap-1">
                        <span className="text-[var(--ink-muted)]">{p.name}:</span>
                        <span className={cn("font-medium", p.flag === "H" ? "text-[var(--rose-600)]" : p.flag === "L" ? "text-blue-600" : "text-[var(--ink)]")}>{p.value} {p.unit}</span>
                        {p.flag && <span className={flagColor(p.flag)}>{p.flag}</span>}
                      </div>
                    ))}
                    {ps.length > 2 && <span className="text-[var(--ink-muted)]">+{ps.length - 2} more</span>}
                    {abnormal.length > 0 && <div className="text-[var(--rose-600)] text-[10px] font-semibold">{abnormal.length} {t("abnormal")}</div>}
                  </div>
                );
              },
            },
            { key: "date",    header: t("date"),   render: l => <span className="text-[12px] text-[var(--ink-muted)]">{formatDate(l.createdAt)}</span> },
            { key: "status",  header: t("status"), render: l => (
              <div className="flex flex-col items-start gap-1">
                <StatusBadge status={l.status} />
                <ClearanceChip status={(l as any).clearanceStatus} charge={(l as any).charge} />
              </div>
            ) },
            {
              key: "actions",
              header: t("actions"),
              render: l => (
                <button
                  className={cn("btn btn-sm h-6 text-xs px-2 gap-1", expandedId === l.id ? "btn-primary" : "btn-outline")}
                  onClick={e => { e.stopPropagation(); openInline(l); }}
                  data-testid={`button-results-${l.id}`}
                >
                  <ClipboardList className="w-3 h-3" />
                  {expandedId === l.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                </button>
              ),
            },
          ]}
        />
      </div>

      <OverrideClearanceDialog
        invoiceId={overrideInvoiceId}
        onOpenChange={o => { if (!o) setOverrideInvoiceId(null); }}
        onDone={() => queryClient.invalidateQueries({ queryKey: getListLabTestsQueryKey() })}
      />

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t("requestLabTest")}</DialogTitle></DialogHeader>
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
              <Label className="text-xs">{t("requestedBy")} *</Label>
              {/* Requester is locked to the signed-in user — not selectable, for any role. */}
              <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3 text-sm text-[var(--ink)]">
                <ShieldCheck className="w-3.5 h-3.5 text-[var(--teal-600)] flex-shrink-0" />
                <span className="truncate">{user?.fullName}</span>
                <span className="text-[var(--ink-muted)] text-xs">({t("you")})</span>
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">{t("testsLabel")} *</Label>
                {lines.length > 1 && <span className="badge badge-blue text-[10px] gap-0.5"><Layers className="w-2.5 h-2.5" />{lines.length}</span>}
              </div>
              {lines.map((ln, i) => (
                <div key={i} className="space-y-1 rounded-md border border-[var(--line)] p-2">
                  <div className="flex gap-2 items-center">
                    <Input value={ln.testName} onChange={e => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, testName: e.target.value } : l))} placeholder={t("egLabTests")} list="common-tests" data-testid={`input-test-name-${i}`} className="h-8 text-sm" />
                    <button type="button" className="btn btn-ghost btn-sm h-8 w-8 p-0 text-[var(--ink-muted)] hover:text-[var(--rose-500)] flex-shrink-0" onClick={() => setLines(ls => ls.length === 1 ? ls : ls.filter((_, idx) => idx !== i))} disabled={lines.length === 1} aria-label={t("remove")}><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                  {showArCreate && (
                    <Input value={ln.testNameAr} onChange={e => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, testNameAr: e.target.value } : l))} placeholder={t("testNameAr")} className="h-8 text-sm text-right" dir="rtl" />
                  )}
                </div>
              ))}
              <datalist id="common-tests">{COMMON_TESTS.map(n => <option key={n} value={n} />)}</datalist>
              <button type="button" className="btn btn-outline btn-sm h-7 text-xs gap-1" onClick={() => setLines(ls => [...ls, { testName: "", testNameAr: "" }])} data-testid="button-add-test">
                <Plus className="w-3 h-3" /> {t("addAnother")}
              </button>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>
            {/* Arabic fields toggle */}
            <button
              type="button"
              className="btn btn-ghost btn-sm h-7 text-xs gap-1.5 text-[var(--ink-muted)] w-full justify-start px-0"
              onClick={() => setShowArCreate(v => !v)}
            >
              <span className="text-base leading-none">ع</span> {t("arabicFields")}
            </button>
            {showArCreate && (
              <div className="space-y-3 border border-[var(--line)] rounded-lg p-3 bg-[var(--surface-2)]" dir="rtl">
                <div className="space-y-1">
                  <Label className="text-xs">{t("notesAr")}</Label>
                  <Textarea value={notesAr} onChange={e => setNotesAr(e.target.value)} rows={2} className="text-right" />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleCreate}
                disabled={createMutation.isPending}
                data-testid="button-save-lab"
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
