import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useListMedicalRecords, useCreateMedicalRecord, useListPatients, useListUsers, useListPatientConsents, useGrantPatientConsent, getListMedicalRecordsQueryKey, getListPatientsQueryKey, getListUsersQueryKey, getListPatientConsentsQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/auth";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { cn } from "@/lib/utils";
import SearchSelect from "@/components/SearchSelect";
import PatientSearchSelect from "@/components/PatientSearchSelect";
import { DetailSection, DetailGrid, DetailField } from "@/components/DetailView";
import { Plus, AlertTriangle, ShieldCheck } from "lucide-react";

// Schema hard bounds — server rejects outside these (see vitalsSchema, strict).
const VITAL_BOUNDS: Record<string, [number, number]> = {
  bpSystolic: [50, 300], bpDiastolic: [30, 200], heartRate: [20, 300],
  temperature: [30, 45], respiratoryRate: [5, 60], oxygenSaturation: [50, 100],
  weight: [0.5, 500], height: [20, 250],
};
// Clinical "normal" ranges — values outside flag amber (informational, not blocking).
const VITAL_NORMAL: Record<string, [number, number]> = {
  bpSystolic: [90, 139], bpDiastolic: [60, 89], heartRate: [60, 100],
  temperature: [36.1, 37.8], respiratoryRate: [12, 20], oxygenSaturation: [95, 100],
};
const isAbnormal = (key: string, raw: string) => {
  const range = VITAL_NORMAL[key];
  if (!raw || !range) return false;
  const n = parseFloat(raw);
  return !isNaN(n) && (n < range[0] || n > range[1]);
};

// Vitals shown in the read-only detail view, in clinical order. `unit` is appended to
// the value ("" for vitals whose i18n label already carries its unit, e.g. "Heart Rate (bpm)");
// `normalKey` maps to VITAL_NORMAL for amber/rose abnormal flagging (omitted = never flagged).
const VITALS_VIEW: { key: string; unit: string; normalKey?: string }[] = [
  { key: "heartRate",        unit: "",        normalKey: "heartRate" },
  { key: "temperature",      unit: "",        normalKey: "temperature" },
  { key: "respiratoryRate",  unit: " /min",   normalKey: "respiratoryRate" },
  { key: "oxygenSaturation", unit: "%",       normalKey: "oxygenSaturation" },
  { key: "weight",           unit: "" },
  { key: "height",           unit: "" },
  { key: "glucose",          unit: " mmol/L" },
  { key: "pain",             unit: "/10" },
];

export default function MedicalRecords() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    patientId: "",
    doctorId: "",
    chiefComplaint: "", chiefComplaintAr: "",
    diagnosis: "", diagnosisAr: "",
    treatment: "", treatmentAr: "",
    notes: "",
    bpSystolic: "", bpDiastolic: "", heartRate: "", temperature: "", respiratoryRate: "", weight: "", height: "", oxygenSaturation: "",
  });
  const [showAr, setShowAr] = useState(false);

  // Deep-link from the patient page (/medical-records?patientId=N): open the
  // create dialog pre-filled for that patient.
  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get("patientId");
    if (pid) { setForm(f => ({ ...f, patientId: pid })); setShowCreate(true); }
  }, []);

  const { data: records, isLoading } = useListMedicalRecords({}, { query: { queryKey: getListMedicalRecordsQueryKey({}) } });
  const { data: patients } = useListPatients({ limit: 200 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200 }) } });

  // Read-only "view all information" detail — opened by clicking a row. The list endpoint
  // already returns every field (vitals, treatment, notes, Arabic), so no extra fetch.
  const [viewRecord, setViewRecord] = useState<NonNullable<typeof records>[number] | null>(null);

  const renderVitals = (vitals: any) => {
    if (!vitals || typeof vitals !== "object" || Object.keys(vitals).length === 0) {
      return <p className="text-[13px] text-[var(--ink-faint)]">{t("noVitalsRecorded")}</p>;
    }
    const bpS = vitals.bloodPressureSystolic, bpD = vitals.bloodPressureDiastolic;
    const bpAbnormal = isAbnormal("bpSystolic", String(bpS)) || isAbnormal("bpDiastolic", String(bpD));
    const vBmi = vitals.weight && vitals.height ? (vitals.weight / Math.pow(vitals.height / 100, 2)) : null;
    return (
      <DetailGrid cols={3}>
        {(bpS != null || bpD != null) && (
          <DetailField label={t("bloodPressure")} value={
            <span className={bpAbnormal ? "text-[var(--rose-500)] font-medium" : undefined}>{bpS ?? "—"}/{bpD ?? "—"} mmHg</span>
          } />
        )}
        {VITALS_VIEW.filter(v => vitals[v.key] != null).map(v => {
          const abnormal = v.normalKey ? isAbnormal(v.normalKey, String(vitals[v.key])) : false;
          return (
            <DetailField key={v.key} label={t(v.key as any)} value={
              <span className={abnormal ? "text-[var(--rose-500)] font-medium" : undefined}>{vitals[v.key]}{v.unit}</span>
            } />
          );
        })}
        {vBmi && isFinite(vBmi) && <DetailField label={t("bmi")} value={vBmi.toFixed(1)} />}
      </DetailGrid>
    );
  };

  // The server requires doctorId to reference a user with the doctor role. When a
  // doctor is signed in, they ARE the doctor (locked). Any other role must pick one.
  const isDoctor = user?.role === "doctor";
  const { data: doctors } = useListUsers(
    { role: "doctor" as any },
    { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }), enabled: !isDoctor } },
  );
  const effectiveDoctorId = isDoctor ? String(user?.id ?? "") : form.doctorId;

  const patientIdNum = parseInt(form.patientId) || 0;
  const consentsKey = getListPatientConsentsQueryKey(patientIdNum);
  const { data: consents } = useListPatientConsents(patientIdNum, {
    query: { enabled: patientIdNum > 0, queryKey: consentsKey },
  });
  const hasTreatmentConsent = !!consents?.some(c => c.consentType === "treatment" && !c.revokedAt);
  // Mirrors GRANT_ROLES in PatientConsentCard — only these roles may record consent.
  const canGrantConsent = ["super_admin", "admin", "nurse", "front_desk"].includes(user?.role ?? "");
  const grantConsentMutation = useGrantPatientConsent({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: consentsKey });
        toast({ title: t("consentGrantedToast") });
      },
      onError: () => toast({ title: t("medicalRecordCreateFailed"), variant: "destructive" }),
    },
  });
  const recordTreatmentConsent = () => {
    if (patientIdNum <= 0) return;
    grantConsentMutation.mutate({
      patientId: patientIdNum,
      data: { consentType: "treatment", documentVersion: "v1.0", notes: null },
    });
  };
  const selectedPatient = patients?.patients?.find(p => String(p.id) === form.patientId);
  const selectedAllergies = (selectedPatient as any)?.allergies as string | null | undefined;
  const bmi = form.weight && form.height
    ? (parseFloat(form.weight) / Math.pow(parseFloat(form.height) / 100, 2))
    : null;

  const createMutation = useCreateMedicalRecord({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMedicalRecordsQueryKey() });
        setShowCreate(false);
        toast({ title: t("medicalRecordCreated") });
      },
      onError: (err: any) => toast({
        title: err?.data?.error_code === 3010 ? t("consentRequiredHint") : t("medicalRecordCreateFailed"),
        variant: "destructive",
      }),
    },
  });

  const handleSave = () => {
    const missing = [
      !form.patientId && t("patient"),
      !effectiveDoctorId && t("doctorLabel"),
      !form.chiefComplaint.trim() && t("chiefComplaint"),
      !form.diagnosis.trim() && t("diagnosis"),
      !form.treatment.trim() && t("treatment"),
    ].filter(Boolean);
    if (missing.length > 0) {
      toast({ title: t("fillRequiredFields"), description: missing.join("، "), variant: "destructive" });
      return;
    }
    // Treatment consent is enforced server-side (422 / 3010) — block early with a clear message.
    if (!hasTreatmentConsent) {
      toast({ title: t("noTreatmentConsent"), variant: "destructive" });
      return;
    }
    // Build vitals with the schema's EXACT keys (bloodPressureSystolic/Diastolic, etc.).
    const num = (v: string, int = false) => (v === "" ? undefined : int ? parseInt(v) : parseFloat(v));
    const rawVitals: Record<string, number | undefined> = {
      bloodPressureSystolic:  num(form.bpSystolic, true),
      bloodPressureDiastolic: num(form.bpDiastolic, true),
      heartRate:              num(form.heartRate, true),
      temperature:            num(form.temperature),
      respiratoryRate:        num(form.respiratoryRate, true),
      oxygenSaturation:       num(form.oxygenSaturation),
      weight:                 num(form.weight),
      height:                 num(form.height),
    };
    if ((rawVitals.bloodPressureSystolic == null) !== (rawVitals.bloodPressureDiastolic == null)) {
      toast({ title: t("bpBothRequired"), variant: "destructive" });
      return;
    }
    const boundKey: Record<string, string> = {
      bloodPressureSystolic: "bpSystolic", bloodPressureDiastolic: "bpDiastolic",
      heartRate: "heartRate", temperature: "temperature", respiratoryRate: "respiratoryRate",
      oxygenSaturation: "oxygenSaturation", weight: "weight", height: "height",
    };
    for (const [vk, val] of Object.entries(rawVitals)) {
      if (val == null || isNaN(val)) continue;
      const [lo, hi] = VITAL_BOUNDS[boundKey[vk]];
      if (val < lo || val > hi) {
        toast({ title: t("vitalOutOfRange"), description: `${vk}: ${lo}–${hi}`, variant: "destructive" });
        return;
      }
    }
    const vitals = Object.fromEntries(Object.entries(rawVitals).filter(([, v]) => v != null && !isNaN(v as number)));
    createMutation.mutate({ data: {
      patientId: parseInt(form.patientId),
      doctorId: parseInt(effectiveDoctorId),
      chiefComplaint: form.chiefComplaint,
      chiefComplaintAr: form.chiefComplaintAr || undefined,
      diagnosis: form.diagnosis,
      diagnosisAr: form.diagnosisAr || undefined,
      treatment: form.treatment,
      treatmentAr: form.treatmentAr || undefined,
      notes: form.notes || undefined,
      vitals: Object.keys(vitals).length ? vitals : undefined,
    } as any });
  };

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <Input
          className="h-8 text-sm max-w-xs"
          placeholder={t("searchByPatientOrDiagnosis")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <button className="btn btn-primary btn-sm gap-1.5 ms-auto" onClick={() => setShowCreate(true)} data-testid="button-create-record">
          <Plus className="w-3.5 h-3.5" /> {t("newMedicalRecord")}
        </button>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          onRowClick={r => setViewRecord(r)}
          data={(records ?? []).filter(r => {
            if (!search) return true;
            const q = search.toLowerCase();
            return (
              r.patient?.fullName?.toLowerCase().includes(q) ||
              r.diagnosis?.toLowerCase().includes(q) ||
              r.chiefComplaint?.toLowerCase().includes(q)
            );
          })}
          emptyMessage={t("noMedicalRecords")}
          columns={[
            {
              key: "patient",
              header: t("patient"),
              render: r => (
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-[13px] text-[var(--ink)]">{r.patient?.fullName || `#${r.patientId}`}</span>
                    {(r.patient as any)?.allergies && (
                      <span title={`${t("allergies")}: ${(r.patient as any).allergies}`}>
                        <AlertTriangle className="w-3.5 h-3.5 text-[var(--rose-500)] shrink-0" />
                      </span>
                    )}
                  </div>
                  {(r.patient as any)?.allergies && (
                    <div className="text-[11px] text-[var(--rose-500)] mt-0.5 truncate max-w-[180px]">
                      ⚠ {(r.patient as any).allergies}
                    </div>
                  )}
                </div>
              ),
            },
            { key: "doctor",    header: t("doctorLabel"),    render: r => <span className="text-[13px] text-[var(--ink)]">{r.doctor?.fullName || `#${r.doctorId}`}</span> },
            { key: "complaint", header: t("chiefComplaint"), render: r => <span className="text-[13px] text-[var(--ink)] max-w-[200px] truncate block">{r.chiefComplaint}</span> },
            { key: "diagnosis", header: t("diagnosis"),      render: r => <span className="text-[13px] text-[var(--ink)] max-w-[200px] truncate block">{r.diagnosis}</span> },
            { key: "date",      header: t("date"),           render: r => <span className="text-[12px] text-[var(--ink-muted)]">{formatDate(r.createdAt)}</span> },
          ]}
        />
      </div>

      {/* Read-only detail — all information for one record */}
      <Dialog open={!!viewRecord} onOpenChange={o => !o && setViewRecord(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("medicalRecordDetails")}</DialogTitle></DialogHeader>
          {viewRecord && (
            <div className="space-y-5">
              <DetailGrid cols={3}>
                <DetailField label={t("patient")} value={viewRecord.patient?.fullName || `#${viewRecord.patientId}`} />
                <DetailField label={t("doctorLabel")} value={viewRecord.doctor?.fullName || `#${viewRecord.doctorId}`} />
                <DetailField label={t("date")} value={formatDate(viewRecord.createdAt)} />
              </DetailGrid>

              <DetailSection>
                <DetailGrid cols={1}>
                  <DetailField label={t("chiefComplaint")} value={viewRecord.chiefComplaint} secondary={(viewRecord as any).chiefComplaintAr} />
                  <DetailField label={t("diagnosis")} value={viewRecord.diagnosis} secondary={(viewRecord as any).diagnosisAr} />
                  <DetailField label={t("treatment")} value={(viewRecord as any).treatment} secondary={(viewRecord as any).treatmentAr} />
                  <DetailField label={t("notes")} value={(viewRecord as any).notes} />
                </DetailGrid>
              </DetailSection>

              <DetailSection title={t("vitals")}>
                {renderVitals((viewRecord as any).vitals)}
              </DetailSection>

              <div className="flex justify-end pt-1">
                <button className="btn btn-outline btn-sm" onClick={() => setViewRecord(null)}>{t("close")}</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("newMedicalRecord")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("patient")} *</Label>
                <PatientSearchSelect
                  testId="select-patient"
                  value={form.patientId}
                  onChange={v => setForm(f => ({ ...f, patientId: v }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("doctorLabel")} *</Label>
                {isDoctor ? (
                  /* A signed-in doctor authors their own records — locked to self. */
                  <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3 text-sm text-[var(--ink)]">
                    <ShieldCheck className="w-3.5 h-3.5 text-[var(--teal-600)] flex-shrink-0" />
                    <span className="truncate">{user?.fullName}</span>
                    <span className="text-[var(--ink-muted)] text-xs">({t("you")})</span>
                  </div>
                ) : (
                  /* Non-doctor roles must attribute the record to a real doctor. */
                  <SearchSelect
                    data-testid="select-doctor"
                    value={form.doctorId}
                    onChange={v => setForm(f => ({ ...f, doctorId: v }))}
                    placeholder={t("selectDoctor")}
                    searchPlaceholder={t("search")}
                    emptyText={t("noResults")}
                    options={(doctors ?? []).map(d => ({
                      value: String(d.id),
                      label: d.fullName,
                      search: d.fullName,
                    }))}
                  />
                )}
              </div>
            </div>
            {form.patientId && (
              <div className="space-y-2">
                {selectedAllergies && (
                  <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--rose-50)", color: "var(--rose-500)" }}>
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span><b>{t("allergies")}:</b> {selectedAllergies}</span>
                  </div>
                )}
                {hasTreatmentConsent ? (
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--teal-50)", color: "var(--teal-700)" }}>
                    <ShieldCheck className="w-4 h-4 flex-shrink-0" />
                    {t("treatmentConsentOnFile")}
                  </div>
                ) : (
                  <div
                    className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12px]"
                    style={{ background: "var(--amber-50)", color: "var(--amber-500)" }}
                  >
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div className="flex flex-col gap-2 flex-1">
                      <span>{t("noTreatmentConsent")}</span>
                      {canGrantConsent ? (
                        <button
                          type="button"
                          onClick={recordTreatmentConsent}
                          disabled={grantConsentMutation.isPending}
                          className="btn btn-outline btn-sm self-start gap-1.5"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                          {grantConsentMutation.isPending ? t("loading") : t("recordTreatmentConsent")}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setLocation(`/patients/${form.patientId}`)}
                          className="underline text-start self-start"
                        >
                          {t("recordConsent")}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">{t("chiefComplaint")} *</Label>
              <Input value={form.chiefComplaint} onChange={e => setForm(f => ({ ...f, chiefComplaint: e.target.value }))} data-testid="input-chief-complaint" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("diagnosis")} *</Label>
              <Textarea value={form.diagnosis} onChange={e => setForm(f => ({ ...f, diagnosis: e.target.value }))} rows={2} data-testid="input-diagnosis" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("treatment")} *</Label>
              <Textarea value={form.treatment} onChange={e => setForm(f => ({ ...f, treatment: e.target.value }))} rows={2} data-testid="input-treatment" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            <div className="pt-1">
              <button type="button" onClick={() => setShowAr(s => !s)} className="text-xs text-[var(--teal-600)] hover:underline">
                {showAr ? "▾" : "▸"} {t("arabicFields")}
              </button>
              {showAr && (
                <div className="mt-2 space-y-3" dir="rtl">
                  <div className="space-y-1">
                    <Label className="text-xs">{t("chiefComplaintAr")}</Label>
                    <Input value={form.chiefComplaintAr} onChange={e => setForm(f => ({ ...f, chiefComplaintAr: e.target.value }))} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("diagnosisAr")}</Label>
                    <Textarea value={form.diagnosisAr} onChange={e => setForm(f => ({ ...f, diagnosisAr: e.target.value }))} rows={2} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t("treatmentAr")}</Label>
                    <Textarea value={form.treatmentAr} onChange={e => setForm(f => ({ ...f, treatmentAr: e.target.value }))} rows={2} />
                  </div>
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold">{t("vitals")}</Label>
                {bmi && !isNaN(bmi) && isFinite(bmi) && (
                  <span className="text-[11px] text-[var(--ink-muted)]">{t("bmi")}: <b className="text-[var(--ink)]">{bmi.toFixed(1)}</b></span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {[
                  { key: "bpSystolic",       label: t("systolic"),         placeholder: "120",  unit: "mmHg" },
                  { key: "bpDiastolic",      label: t("diastolic"),        placeholder: "80",   unit: "mmHg" },
                  { key: "heartRate",        label: t("heartRate"),        placeholder: "72",   unit: "bpm" },
                  { key: "temperature",      label: t("temperature"),      placeholder: "37.0", unit: "°C" },
                  { key: "respiratoryRate",  label: t("respiratoryRate"),  placeholder: "16",   unit: "/min" },
                  { key: "oxygenSaturation", label: t("oxygenSaturation"), placeholder: "98",   unit: "%" },
                  { key: "weight",           label: t("weight"),           placeholder: "70",   unit: "kg" },
                  { key: "height",           label: t("height"),           placeholder: "175",  unit: "cm" },
                ].map(v => {
                  const abnormal = isAbnormal(v.key, (form as any)[v.key]);
                  return (
                    <div key={v.key} className="space-y-1">
                      <Label className="text-[10px]">{v.label} <span className="text-[var(--ink-faint)]">({v.unit})</span></Label>
                      <Input
                        type="number"
                        className={cn("h-7 text-xs", abnormal && "border-[var(--rose-500)] text-[var(--rose-500)]")}
                        placeholder={v.placeholder}
                        value={(form as any)[v.key]}
                        onChange={e => setForm(f => ({ ...f, [v.key]: e.target.value }))}
                      />
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-[var(--ink-muted)] mt-1.5">{t("vitalsAbnormalHint")}</p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={createMutation.isPending} data-testid="button-save-record">
                {createMutation.isPending ? t("loading") : t("save")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
