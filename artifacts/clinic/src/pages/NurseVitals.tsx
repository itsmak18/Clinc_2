import { useMemo, useState } from "react";
import {
  useListPatients, useCreateVitals, useListVitals, useGetNurseDashboard,
  getListPatientsQueryKey, getListVitalsQueryKey, getGetNurseDashboardQueryKey,
} from "@workspace/api-client-react";
import type { VitalsMeasurements, VitalRecord } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PatientSearchSelect from "@/components/PatientSearchSelect";
import VitalChip, { vitalStatus, type VitalKey, type VitalStatus } from "@/components/VitalChip";
import { Activity, Save, RotateCcw, AlertTriangle, History, Clock } from "lucide-react";

interface VitalsForm {
  patientId: string;
  systolic: string;
  diastolic: string;
  heartRate: string;
  temperature: string;
  oxygenSaturation: string;
  respiratoryRate: string;
  glucose: string;
}

const EMPTY: VitalsForm = {
  patientId: "", systolic: "", diastolic: "", heartRate: "", temperature: "",
  oxygenSaturation: "", respiratoryRate: "", glucose: "",
};

/** Measurement fields. `vk` is the canonical clinical-range key (null = no range, e.g. diastolic). */
const FIELDS: { key: keyof VitalsForm; vk: VitalKey | null; unit: string; ph: string; int: boolean }[] = [
  { key: "systolic",         vk: "bp",      unit: "mmHg",   ph: "120",  int: true },
  { key: "diastolic",        vk: null,      unit: "mmHg",   ph: "80",   int: true },
  { key: "heartRate",        vk: "hr",      unit: "bpm",    ph: "72",   int: true },
  { key: "temperature",      vk: "temp",    unit: "°C",     ph: "37.0", int: false },
  { key: "oxygenSaturation", vk: "spo2",    unit: "%",      ph: "98",   int: false },
  { key: "respiratoryRate",  vk: "rr",      unit: "/min",   ph: "16",   int: true },
  { key: "glucose",          vk: "glucose", unit: "mmol/L", ph: "5.5",  int: false },
];

/** Diastolic has no VitalChip range; apply a simple local rule so it can still flag. */
function diastolicStatus(v: number): VitalStatus {
  if (isNaN(v)) return "normal";
  if (v < 40 || v > 120) return "critical";
  if (v < 60 || v > 89) return "warning";
  return "normal";
}

function fieldStatus(field: typeof FIELDS[number], raw: string): VitalStatus {
  if (raw === "") return "normal";
  const v = parseFloat(raw);
  if (field.key === "diastolic") return diastolicStatus(v);
  return field.vk ? vitalStatus(field.vk, v) : "normal";
}

const STATUS_CLASS: Record<VitalStatus, string> = {
  normal: "",
  warning: "border-[var(--amber-500)] text-[var(--amber-600)] focus-visible:outline-[var(--amber-500)]",
  critical: "border-[var(--rose-500)] text-[var(--rose-500)] focus-visible:outline-[var(--rose-500)]",
};

const PRIORITY_TONE: Record<string, string> = {
  critical: "badge-rose", urgent: "badge-sand", normal: "badge-blue",
};

export default function NurseVitals() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<VitalsForm>(EMPTY);

  const isNurse = user?.role === "nurse";
  const patientIdNum = form.patientId ? parseInt(form.patientId) : undefined;

  const { data: patients } = useListPatients({ limit: 200 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200 }) } });
  const { data: nurseDash } = useGetNurseDashboard({ query: { enabled: isNurse, queryKey: getGetNurseDashboardQueryKey(), refetchInterval: 30000 } });

  const recentParams = patientIdNum ? { patientId: patientIdNum } : undefined;
  const { data: recent } = useListVitals(recentParams, { query: { queryKey: getListVitalsQueryKey(recentParams) } });

  // patientId → fullName, so quick-pick chips + recent rows can show names (the
  // nurse-dashboard / vitals payloads carry IDs only — no PHI on the wire).
  const nameById = useMemo(() => {
    const m = new Map<number, string>();
    patients?.patients?.forEach(p => m.set(p.id, p.fullName));
    return m;
  }, [patients]);

  const waiting = isNurse ? (nurseDash?.vitalsPending ?? []) : [];

  const createMutation = useCreateVitals({
    mutation: {
      onSuccess: () => {
        toast({ title: t("vitalsRecorded") });
        setForm(f => ({ ...EMPTY, patientId: f.patientId }));
        queryClient.invalidateQueries({ queryKey: ["/api/vitals"] });
        queryClient.invalidateQueries({ queryKey: getGetNurseDashboardQueryKey() });
      },
      onError: () => toast({ title: t("vitalsRecordFailed"), variant: "destructive" }),
    },
  });

  const setField = (key: keyof VitalsForm, value: string) => setForm(f => ({ ...f, [key]: value }));

  const bpHalfFilled = (form.systolic !== "") !== (form.diastolic !== "");
  const hasMeasurement = FIELDS.some(f => (form[f.key] as string) !== "");
  const abnormalCount = FIELDS.filter(f => {
    const s = fieldStatus(f, form[f.key] as string);
    return s !== "normal";
  }).length;
  const canSubmit = !!form.patientId && hasMeasurement && !bpHalfFilled;

  const submit = () => {
    if (bpHalfFilled) {
      toast({ title: t("bpBothRequired"), variant: "destructive" });
      return;
    }
    const intOf = (s: string) => (s === "" ? undefined : parseInt(s));
    const floatOf = (s: string) => (s === "" ? undefined : parseFloat(s));
    const raw: VitalsMeasurements = {
      bloodPressureSystolic:  intOf(form.systolic),
      bloodPressureDiastolic: intOf(form.diastolic),
      heartRate:              intOf(form.heartRate),
      temperature:            floatOf(form.temperature),
      oxygenSaturation:       floatOf(form.oxygenSaturation),
      respiratoryRate:        intOf(form.respiratoryRate),
      glucose:                floatOf(form.glucose),
    };
    // Drop undefined / NaN so we never send a partial or malformed reading.
    const vitals = Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v != null && !Number.isNaN(v)),
    ) as VitalsMeasurements;

    // The visit auto-advances to ready_for_doctor server-side (createVitals
    // resolves the patient's active visit — no appointment id needed).
    createMutation.mutate({ data: { patientId: parseInt(form.patientId), vitals } as any });
  };

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <Activity className="w-5 h-5 text-[var(--teal-600)]" />
        <h1 className="font-semibold text-[var(--ink)] text-[15px]">{t("rapidVitalsEntry")}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* ── Entry form ─────────────────────────────────────────── */}
        <div className="card lg:col-span-2">
          <div className="card-pad space-y-4">
            {/* Patient */}
            <div className="space-y-1">
              <Label className="text-xs">{t("patient")} *</Label>
              <PatientSearchSelect
                value={form.patientId}
                selectedName={patientIdNum ? nameById.get(patientIdNum) : undefined}
                onChange={id => setField("patientId", id)}
              />

              {/* One-tap pick of patients currently awaiting vitals */}
              {waiting.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1.5">
                  <span className="text-[11px] text-[var(--ink-muted)] inline-flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {t("nurseVitalsPending")}:
                  </span>
                  {waiting.slice(0, 8).map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setField("patientId", String(p.patientId))}
                      className={cn(
                        "badge text-[11px] hover:opacity-80 transition-opacity cursor-pointer",
                        PRIORITY_TONE[p.priority] ?? "badge-blue",
                        String(p.patientId) === form.patientId && "ring-2 ring-[var(--teal-500)]",
                      )}
                      data-testid={`quick-pick-${p.patientId}`}
                    >
                      {nameById.get(p.patientId) ?? `#${p.patientId}`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Vitals grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {FIELDS.map(f => {
                const val = form[f.key] as string;
                const status = fieldStatus(f, val);
                return (
                  <div key={f.key} className="space-y-1">
                    <Label className="text-[11px] flex items-center gap-1">
                      {t(f.key as Parameters<typeof t>[0])}
                      <span className="text-[var(--ink-faint)]">({f.unit})</span>
                      {status !== "normal" && (
                        <AlertTriangle className={cn("w-3 h-3", status === "critical" ? "text-[var(--rose-500)]" : "text-[var(--amber-500)]")} />
                      )}
                    </Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      className={cn("h-9 text-sm font-mono", STATUS_CLASS[status])}
                      placeholder={f.ph}
                      value={val}
                      aria-invalid={status !== "normal"}
                      onChange={e => setField(f.key, e.target.value)}
                      data-testid={`input-${f.key}`}
                    />
                  </div>
                );
              })}
            </div>

            {bpHalfFilled && (
              <p className="text-[11px] text-[var(--rose-500)] flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> {t("bpBothRequired")}
              </p>
            )}

            {/* Footer: status summary + actions */}
            <div className="flex items-center justify-between gap-2 pt-3 border-t border-[var(--line)]">
              <span className="text-[11px] text-[var(--ink-muted)]">
                {abnormalCount > 0
                  ? <span className="inline-flex items-center gap-1 text-[var(--amber-600)]">
                      <AlertTriangle className="w-3 h-3" /> {abnormalCount} {t("vitalsOutOfRangeSuffix")}
                    </span>
                  : t("vitalsAbnormalHint")}
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-ghost btn-sm gap-1.5"
                  onClick={() => setForm(EMPTY)}
                  disabled={createMutation.isPending}
                  data-testid="button-clear-vitals"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {t("clearForm")}
                </button>
                <button
                  className="btn btn-primary btn-sm gap-1.5"
                  onClick={submit}
                  disabled={!canSubmit || createMutation.isPending}
                  aria-label={t("submitVitals")}
                  data-testid="button-submit-vitals"
                >
                  <Save className="w-3.5 h-3.5" />
                  {createMutation.isPending ? t("loading") : t("submitVitals")}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Recently recorded ──────────────────────────────────── */}
        <div className="card lg:col-span-1">
          <div className="card-pad">
            <div className="flex items-center gap-2 mb-3">
              <History className="w-4 h-4 text-[var(--teal-600)]" />
              <span className="font-semibold text-[var(--ink)] text-[13px]">{t("vitalsRecentTitle")}</span>
            </div>
            {!recent?.length ? (
              <div className="flex flex-col items-center justify-center py-10 text-[var(--ink-faint)] gap-2">
                <Activity className="w-7 h-7 opacity-30" />
                <p className="text-[12px]">{t("vitalsNoneYet")}</p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {recent.slice(0, 10).map(r => (
                  <RecentRow key={r.id} record={r} name={nameById.get(r.patientId)} showName={!patientIdNum} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function RecentRow({ record, name, showName }: { record: VitalRecord; name?: string; showName: boolean }) {
  const v = record.vitals ?? {};
  return (
    <div className="rounded-[var(--r-sm)] border border-[var(--line)] bg-[var(--surface-2)] px-2.5 py-2">
      <div className="flex items-center justify-between mb-1.5">
        {showName && <span className="text-[12px] font-medium text-[var(--ink)] truncate">{name ?? `#${record.patientId}`}</span>}
        <span className="text-[10px] text-[var(--ink-faint)] ms-auto">{formatDateTime(record.createdAt)}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {v.bloodPressureSystolic != null && (
          <VitalChip vitalKey="bp" value={`${v.bloodPressureSystolic}/${v.bloodPressureDiastolic ?? "—"}`} />
        )}
        {v.heartRate != null && <VitalChip vitalKey="hr" value={v.heartRate} />}
        {v.temperature != null && <VitalChip vitalKey="temp" value={v.temperature} />}
        {v.oxygenSaturation != null && <VitalChip vitalKey="spo2" value={v.oxygenSaturation} />}
        {v.respiratoryRate != null && <VitalChip vitalKey="rr" value={v.respiratoryRate} />}
        {v.glucose != null && <VitalChip vitalKey="glucose" value={v.glucose} />}
      </div>
    </div>
  );
}
