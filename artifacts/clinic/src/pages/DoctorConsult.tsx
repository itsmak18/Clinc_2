import { useEffect, useState } from "react";
import {
  useGetPatientSummary, useListMedicalRecords, useListPrescriptions, useListPatients,
  useCreateMedicalRecord, useCreatePrescription,
  getGetPatientSummaryQueryKey, getListMedicalRecordsQueryKey, getListPrescriptionsQueryKey, getListPatientsQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useCurrentPatientId } from "@/hooks/useUrlSync";
import PatientHeaderStrip from "@/components/PatientHeaderStrip";
import PatientTimeline from "@/components/PatientTimeline";
import DataTable from "@/components/DataTable";
import StatusBadge from "@/components/StatusBadge";
import DoctorOrders from "./DoctorOrders";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { formatDate, formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Activity, FileText, FlaskConical, NotebookPen, Pill, Save, UserSearch, ChevronDown } from "lucide-react";

interface SoapForm {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

const EMPTY_SOAP: SoapForm = { subjective: "", objective: "", assessment: "", plan: "" };

export default function DoctorConsult() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [patientId, setPatientId] = useCurrentPatientId();
  const [tab, setTab] = useState("summary");
  const [openRecordId, setOpenRecordId] = useState<number | null>(null);
  const [soap, setSoap] = useState<SoapForm>(EMPTY_SOAP);
  const [pendingTab, setPendingTab] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(!patientId);

  const dirty =
    soap.subjective.trim() !== "" ||
    soap.objective.trim() !== "" ||
    soap.assessment.trim() !== "" ||
    soap.plan.trim() !== "";

  const { data: summary, isLoading: summaryLoading } = useGetPatientSummary(patientId!, {
    query: { enabled: !!patientId, queryKey: getGetPatientSummaryQueryKey(patientId!) },
  });

  const { data: records } = useListMedicalRecords(
    { patientId: patientId ?? undefined } as any,
    { query: { enabled: !!patientId, queryKey: getListMedicalRecordsQueryKey({ patientId: patientId ?? undefined } as any) } }
  );

  const { data: rx } = useListPrescriptions(
    { patientId: patientId ?? undefined } as any,
    { query: { enabled: !!patientId, queryKey: getListPrescriptionsQueryKey({ patientId: patientId ?? undefined } as any) } }
  );

  const { data: patients } = useListPatients(
    { limit: 200 },
    { query: { enabled: showPicker, queryKey: getListPatientsQueryKey({ limit: 200 }) } }
  );

  const createRecord = useCreateMedicalRecord({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMedicalRecordsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetPatientSummaryQueryKey(patientId!) });
        toast({ title: t("save") });
        setSoap(EMPTY_SOAP);
      },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  // Reset SOAP + any open record when patient changes
  useEffect(() => { setSoap(EMPTY_SOAP); setOpenRecordId(null); }, [patientId]);

  // Dirty-guard on tab change
  const handleTabChange = (next: string) => {
    if (dirty && tab === "notes" && next !== "notes") {
      setPendingTab(next);
      return;
    }
    setTab(next);
  };

  const confirmDiscard = () => {
    if (pendingTab) {
      setSoap(EMPTY_SOAP);
      setTab(pendingTab);
      setPendingTab(null);
    }
  };

  const saveSoap = () => {
    if (!patientId || !user) return;
    createRecord.mutate({
      data: {
        patientId,
        doctorId: user.id,
        chiefComplaint: soap.subjective || t("subjective"),
        diagnosis: soap.assessment || t("assessment"),
        treatment: soap.plan || t("plan"),
        notes: soap.objective || undefined,
      } as any,
    });
  };

  const patient = summary?.patient as any;
  const allergyList = patient?.allergies
    ? String(patient.allergies).split(/[,;]/).map((s: string) => s.trim()).filter(Boolean)
    : undefined;

  return (
    <div className="page">
      {!patientId ? (
        <div className="card max-w-md mx-auto mt-12">
          <div className="card-pad text-center space-y-3">
            <UserSearch className="w-10 h-10 mx-auto text-[var(--teal-600)]" />
            <h2 className="font-semibold text-[var(--ink)] text-[15px]">{t("selectPatientToConsult")}</h2>
            <Select value="" onValueChange={v => { setPatientId(parseInt(v)); setShowPicker(false); }}>
              <SelectTrigger aria-label={t("selectPatient")} data-testid="select-consult-patient">
                <SelectValue placeholder={t("selectPatient")} />
              </SelectTrigger>
              <SelectContent>
                {patients?.patients?.map(p => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : (
        <>
          {/* Header strip */}
          {summaryLoading ? (
            <div className="card mb-4">
              <div className="card-pad h-24 bg-[var(--surface-2)] animate-pulse rounded" />
            </div>
          ) : patient ? (
            <div className="card mb-4">
              <PatientHeaderStrip
                name={patient.fullName}
                mrn={patient.mrn}
                dob={patient.dateOfBirth}
                gender={patient.gender}
                allergies={allergyList}
              />
            </div>
          ) : null}

          {/* Switch patient pill */}
          <div className="flex items-center gap-2 mb-4">
            <button
              className="btn btn-outline btn-sm gap-1.5"
              onClick={() => { setPatientId(null); setShowPicker(true); }}
              aria-label={t("selectPatient")}
            >
              <UserSearch className="w-3.5 h-3.5" /> {t("selectPatient")}
            </button>
          </div>

          {/* Tabs */}
          <Tabs value={tab} onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="summary" className="gap-1.5"><FileText className="w-3.5 h-3.5" /> {t("summary")}</TabsTrigger>
              <TabsTrigger value="history" className="gap-1.5"><Activity className="w-3.5 h-3.5" /> {t("history")}</TabsTrigger>
              <TabsTrigger value="orders"  className="gap-1.5"><FlaskConical className="w-3.5 h-3.5" /> {t("ordersTab")}</TabsTrigger>
              <TabsTrigger value="notes"   className="gap-1.5"><NotebookPen className="w-3.5 h-3.5" /> {t("notesTab")}{dirty && <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber-500)]" aria-hidden="true" />}</TabsTrigger>
              <TabsTrigger value="rx"      className="gap-1.5"><Pill className="w-3.5 h-3.5" /> {t("rxTab")}</TabsTrigger>
            </TabsList>

            {/* Summary */}
            <TabsContent value="summary" className="mt-4">
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="card">
                  <div className="card-pad border-b border-[var(--line)]">
                    <span className="font-semibold text-[13px] text-[var(--ink)]">{t("recentMedicalRecords")}</span>
                  </div>
                  <div className="card-pad space-y-2">
                    {!(records ?? summary?.recentRecords)?.length
                      ? <p className="text-xs text-[var(--ink-muted)]">{t("noRecords")}</p>
                      : (records ?? summary?.recentRecords ?? []).slice(0, 5).map((r: any, i: number) => {
                        const open = openRecordId === r.id;
                        return (
                          <div key={r.id ?? i} className="border-b border-[var(--line)]/40 pb-2 last:border-0 last:pb-0">
                            <button
                              type="button"
                              onClick={() => setOpenRecordId(open ? null : r.id)}
                              aria-expanded={open}
                              className="w-full text-start flex items-start gap-2 rounded-md -mx-1 px-1 py-0.5 hover:bg-[var(--surface-2)] transition-colors"
                              data-testid={`record-summary-${r.id ?? i}`}
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-[var(--ink)]">{r.diagnosis}</p>
                                <p className="text-xs text-[var(--ink-muted)]">{r.chiefComplaint} · {formatDate(r.createdAt)}</p>
                              </div>
                              <ChevronDown className={cn("w-3.5 h-3.5 text-[var(--ink-muted)] flex-shrink-0 mt-0.5 transition-transform", open && "rotate-180")} />
                            </button>
                            {open && (
                              <div className="mt-2 ms-1 space-y-2 text-xs border-s-2 border-[var(--teal-200)] ps-3">
                                {r.doctor?.fullName && (
                                  <div><span className="text-[var(--ink-muted)]">{t("doctorLabel")}: </span><span className="text-[var(--ink)]">{r.doctor.fullName}</span></div>
                                )}
                                {r.treatment && (
                                  <div>
                                    <p className="font-semibold text-[var(--ink-muted)] uppercase tracking-wide text-[10px] mb-0.5">{t("treatment")}</p>
                                    <p className="text-[var(--ink)] whitespace-pre-wrap leading-relaxed">{r.treatment}</p>
                                  </div>
                                )}
                                {r.notes && (
                                  <div>
                                    <p className="font-semibold text-[var(--ink-muted)] uppercase tracking-wide text-[10px] mb-0.5">{t("notes")}</p>
                                    <p className="text-[var(--ink)] whitespace-pre-wrap leading-relaxed">{r.notes}</p>
                                  </div>
                                )}
                                {!r.treatment && !r.notes && (
                                  <p className="text-[var(--ink-muted)] italic">{t("noAdditionalDetails")}</p>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                </div>
                <div className="card">
                  <div className="card-pad border-b border-[var(--line)]">
                    <span className="font-semibold text-[13px] text-[var(--ink)]">{t("recentAppointments")}</span>
                  </div>
                  <div className="card-pad space-y-2">
                    {!summary?.recentAppointments?.length
                      ? <p className="text-xs text-[var(--ink-muted)]">{t("noAppointments")}</p>
                      : summary.recentAppointments.slice(0, 5).map((a: any, i: number) => (
                        <div key={i} className="flex items-center gap-2 text-xs border-b border-[var(--line)]/40 pb-2">
                          <div className="flex-1">
                            <p className="font-medium text-[var(--ink)]">{a.reason}</p>
                            <p className="text-[var(--ink-muted)]">{formatDateTime(a.scheduledAt)}</p>
                          </div>
                          <StatusBadge status={a.status} />
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* History */}
            <TabsContent value="history" className="mt-4">
              <div className="card">
                <div className="card-pad border-b border-[var(--line)]">
                  <span className="font-semibold text-[13px] text-[var(--ink)]">{t("completeClinicalTimeline")}</span>
                </div>
                <div className="card-pad pb-6 pt-2">
                  <PatientTimeline
                    appointments={summary?.recentAppointments as any}
                    records={summary?.recentRecords as any}
                    labTests={summary?.recentLabTests as any}
                    xrays={summary?.recentXrays as any}
                  />
                </div>
              </div>
            </TabsContent>

            {/* Orders — re-uses DoctorOrders content scoped */}
            <TabsContent value="orders" className="mt-4">
              <DoctorOrders />
            </TabsContent>

            {/* Notes — SOAP entry */}
            <TabsContent value="notes" className="mt-4">
              <div className="card max-w-3xl">
                <div className="card-pad border-b border-[var(--line)] flex items-center justify-between">
                  <span className="font-semibold text-[13px] text-[var(--ink)]">{t("soapNotes")}</span>
                  {dirty && (
                    <span className="text-[11px] text-[var(--amber-600)]" role="status">{t("unsavedChanges")}</span>
                  )}
                </div>
                <div className="card-pad space-y-3">
                  {([
                    { key: "subjective", label: t("subjective") },
                    { key: "objective",  label: t("objective") },
                    { key: "assessment", label: t("assessment") },
                    { key: "plan",       label: t("plan") },
                  ] as const).map(field => (
                    <div key={field.key} className="space-y-1">
                      <Label className="text-xs">{field.label}</Label>
                      <Textarea
                        rows={3}
                        value={soap[field.key]}
                        onChange={e => setSoap(s => ({ ...s, [field.key]: e.target.value }))}
                        data-testid={`input-soap-${field.key}`}
                      />
                    </div>
                  ))}
                  <div className="flex justify-end gap-2 pt-2 border-t border-[var(--line)]">
                    <button
                      className="btn btn-outline btn-sm"
                      onClick={() => setSoap(EMPTY_SOAP)}
                      disabled={!dirty}
                    >
                      {t("cancel")}
                    </button>
                    <button
                      className="btn btn-primary btn-sm gap-1.5"
                      onClick={saveSoap}
                      disabled={!dirty || createRecord.isPending}
                      aria-label={t("saveAndFinalize")}
                      data-testid="button-save-soap"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {createRecord.isPending ? t("loading") : t("saveAndFinalize")}
                    </button>
                  </div>
                </div>
              </div>
            </TabsContent>

            {/* Rx — prescriptions list */}
            <TabsContent value="rx" className="mt-4">
              <div className="card overflow-hidden">
                <DataTable
                  data={rx ?? []}
                  emptyMessage={t("noRecords")}
                  columns={[
                    { key: "date",    header: t("date"),    render: (r: any) => <span className="text-[12px] text-[var(--ink-muted)]">{formatDate(r.createdAt)}</span> },
                    {
                      key: "meds",
                      header: t("medications"),
                      render: (r: any) => (
                        <div className="text-[13px]">
                          {(r.medications ?? []).map((m: any, i: number) => (
                            <div key={i}><span className="font-medium text-[var(--ink)]">{m.name}</span> <span className="text-[var(--ink-muted)]">— {m.dosage} · {m.frequency} · {m.duration}</span></div>
                          ))}
                        </div>
                      ),
                    },
                    { key: "notes",   header: t("notes"),   render: (r: any) => <span className="text-[12px] text-[var(--ink-muted)] line-clamp-1 max-w-[280px]">{r.notes ?? "—"}</span> },
                  ]}
                />
              </div>
            </TabsContent>
          </Tabs>

          {/* Dirty-discard confirmation */}
          <Dialog open={!!pendingTab} onOpenChange={(open) => { if (!open) setPendingTab(null); }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>{t("discardChanges")}</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-[var(--ink-muted)]">{t("unsavedChanges")}</p>
              <div className="flex justify-end gap-2 pt-2">
                <button className="btn btn-outline btn-sm" onClick={() => setPendingTab(null)}>{t("keepEditing")}</button>
                <button className="btn btn-danger btn-sm" onClick={confirmDiscard}>{t("discard")}</button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
