import { useState } from "react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTodayAppointments,
  useStartTriage,
  useUpdateAppointment,
  useCreateVitals,
  getGetTodayAppointmentsQueryKey,
  getListAppointmentsQueryKey,
} from "@workspace/api-client-react";
import StatusBadge from "@/components/StatusBadge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Activity, User, ArrowRight, ClipboardList } from "lucide-react";
import { useAuth } from "@/hooks/auth";
import { cn } from "@/lib/utils";

interface VitalsForm {
  bloodPressure: string;
  heartRate: string;
  temperature: string;
  weight: string;
  height: string;
  oxygenSaturation: string;
  notes: string;
}

type Priority = "normal" | "urgent" | "critical";

const PRIORITY_STYLES: Record<Priority, { pill: string; border: string }> = {
  normal:   { pill: "badge",            border: "border-[var(--line)]"      },
  urgent:   { pill: "badge badge-sand", border: "border-[var(--amber-400)]" },
  critical: { pill: "badge badge-rose", border: "border-[var(--rose-500)]"  },
};

// i18n key per priority — resolved with t() at render time.
const PRIORITY_LABEL_KEY = { normal: "priorityNormal", urgent: "priorityUrgent", critical: "priorityCritical" } as const;

const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, urgent: 1, normal: 2 };

/** Parse a "120/80" cuff reading into the structured systolic/diastolic the
 *  vitalsSchema requires. Returns {} when the input isn't a valid pair. */
function parseBP(s: string): { bloodPressureSystolic?: number; bloodPressureDiastolic?: number } {
  const m = (s ?? "").trim().match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
  return m ? { bloodPressureSystolic: parseInt(m[1]), bloodPressureDiastolic: parseInt(m[2]) } : {};
}

function sortByPriority(appts: any[]): any[] {
  return [...appts].sort((a, b) => {
    const pa = PRIORITY_ORDER[(a.triagePriority as Priority) ?? "normal"] ?? 2;
    const pb = PRIORITY_ORDER[(b.triagePriority as Priority) ?? "normal"] ?? 2;
    if (pa !== pb) return pa - pb;
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });
}

// Existing kanban implementation — intentionally NOT rendered for now. Triage is
// shelved behind a "Coming Soon" placeholder (see the default export below) until
// the workflow is finalized. Re-enable by exporting this as default again.
function TriageWorkflow() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [selectedAppt, setSelectedAppt] = useState<any | null>(null);
  const [vitals, setVitals] = useState<VitalsForm>({
    bloodPressure: "", heartRate: "", temperature: "", weight: "", height: "", oxygenSaturation: "", notes: ""
  });
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [quickVitals, setQuickVitals] = useState<Record<number, { bp: string; temp: string; pulse: string }>>({});
  const [quickSaving, setQuickSaving] = useState<number | null>(null);

  const { data, isLoading } = useGetTodayAppointments({
    query: { queryKey: getGetTodayAppointmentsQueryKey(), refetchInterval: 15000 }
  });

  const allAppts = data?.appointments ?? [];
  const matchesSearch = (a: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.patient?.fullName?.toLowerCase().includes(q) ||
      a.patient?.mrn?.toLowerCase().includes(q)
    );
  };
  const waiting = sortByPriority(allAppts.filter(a => a.status === "checked_in" && matchesSearch(a)));
  const inTriage = sortByPriority(allAppts.filter(a => a.status === "in_triage" && matchesSearch(a)));
  const readyForDoctor = sortByPriority(allAppts.filter(a => a.status === "ready_for_doctor" && matchesSearch(a)));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getGetTodayAppointmentsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
  };

  const startTriageMutation = useStartTriage({
    mutation: { onSuccess: () => invalidate(), onError: () => toast({ title: t("failed"), variant: "destructive" }) },
  });
  const updateAppointmentMutation = useUpdateAppointment({
    mutation: { onSuccess: () => invalidate(), onError: () => toast({ title: t("failed"), variant: "destructive" }) },
  });
  const createVitalsMutation = useCreateVitals();

  const handleStartTriage = async (appt: any) => {
    try {
      await startTriageMutation.mutateAsync({ appointmentId: appt.id });
      setSelectedAppt(appt);
      setVitals({ bloodPressure: "", heartRate: "", temperature: "", weight: "", height: "", oxygenSaturation: "", notes: "" });
    } catch { /* onError toast already fired */ }
  };

  const handleContinueTriage = (appt: any) => {
    setSelectedAppt(appt);
    setVitals({ bloodPressure: "", heartRate: "", temperature: "", weight: "", height: "", oxygenSaturation: "", notes: "" });
  };

  const handleSetPriority = (appt: any, priority: Priority) => {
    updateAppointmentMutation.mutate({ appointmentId: appt.id, data: { triagePriority: priority } as any });
  };

  const handleQuickVitalsSave = async (appt: any) => {
    const qv = quickVitals[appt.id];
    if (!qv) return;
    setQuickSaving(appt.id);
    try {
      await createVitalsMutation.mutateAsync({
        data: {
          patientId: appt.patientId,
          appointmentId: appt.id,
          vitals: {
            ...parseBP(qv.bp),
            heartRate: qv.pulse ? parseInt(qv.pulse) : undefined,
            temperature: qv.temp ? parseFloat(qv.temp) : undefined,
          },
        } as any,
      });
      toast({ title: t("vitalsRecorded") });
      setQuickVitals(prev => { const next = { ...prev }; delete next[appt.id]; return next; });
    } catch {
      toast({ title: t("vitalsRecordFailed"), variant: "destructive" });
    } finally {
      setQuickSaving(null);
    }
  };

  const handleCompleteVitals = async () => {
    if (!selectedAppt) return;
    setLoading(true);
    try {
      const vitalsData = {
        ...parseBP(vitals.bloodPressure),
        heartRate: vitals.heartRate ? parseInt(vitals.heartRate) : undefined,
        temperature: vitals.temperature ? parseFloat(vitals.temperature) : undefined,
        weight: vitals.weight ? parseFloat(vitals.weight) : undefined,
        height: vitals.height ? parseFloat(vitals.height) : undefined,
        oxygenSaturation: vitals.oxygenSaturation ? parseFloat(vitals.oxygenSaturation) : undefined,
      };

      // createVitals auto-advances the visit to ready_for_doctor (Phase 2). The old
      // explicit markReady that followed double-fired with it → 409. Dropped.
      await createVitalsMutation.mutateAsync({
        data: {
          patientId: selectedAppt.patientId,
          appointmentId: selectedAppt.id,
          notes: vitals.notes || undefined,
          vitals: vitalsData,
        } as any,
      });
      toast({ title: t("vitalsRecorded") });
      setSelectedAppt(null);
      invalidate();
    } catch {
      toast({ title: t("vitalsRecordFailed"), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const canTriage = user?.role === "nurse" || user?.role === "admin" || user?.role === "super_admin";

  const PriorityToggle = ({ appt }: { appt: any }) => {
    const current: Priority = (appt.triagePriority as Priority) ?? "normal";
    return (
      <div className="flex gap-1 mt-1.5">
        {(["normal", "urgent", "critical"] as Priority[]).map(p => (
          <button
            key={p}
            onClick={() => handleSetPriority(appt, p)}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded font-medium transition-opacity",
              current === p ? PRIORITY_STYLES[p].pill : "bg-[var(--surface-2)] text-[var(--ink-muted)]/60 hover:opacity-80"
            )}
          >
            {t(PRIORITY_LABEL_KEY[p])}
          </button>
        ))}
      </div>
    );
  };

  const AppointmentCard = ({ appt, action, showQuickVitals }: { appt: any; action?: React.ReactNode; showQuickVitals?: boolean }) => {
    const priority: Priority = (appt.triagePriority as Priority) ?? "normal";
    const styles = PRIORITY_STYLES[priority];
    const qv = quickVitals[appt.id] ?? { bp: "", temp: "", pulse: "" };

    return (
      <div className={cn(
        "flex flex-col gap-2 p-3 rounded-lg border-s-4 border bg-[var(--bg)] hover:bg-[var(--surface-2)] transition-colors",
        styles.border
      )}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[var(--teal-100)] text-[var(--teal-700)] flex items-center justify-center shrink-0">
            <User className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-[13px] text-[var(--ink)] truncate">{appt.patient?.fullName || `${t("patient")} #${appt.patientId}`}</p>
            <p className="text-[11px] text-[var(--ink-muted)] font-mono">{appt.patient?.mrn}</p>
            <p className="text-[11px] text-[var(--ink-muted)] truncate">{appt.doctor?.fullName}</p>
            {appt.patient?.allergies && (
              <div className="flex items-center gap-1 mt-0.5">
                <AlertTriangle className="w-3 h-3 text-[var(--rose-500)] shrink-0" />
                <p className="text-[11px] text-[var(--rose-500)] truncate">{appt.patient.allergies}</p>
              </div>
            )}
            {canTriage && <PriorityToggle appt={appt} />}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {priority !== "normal" && (
              <span className={styles.pill}>{t(PRIORITY_LABEL_KEY[priority])}</span>
            )}
            <StatusBadge status={appt.status} />
            {action}
          </div>
        </div>

        {/* Inline Quick Vitals — only on in_triage cards for nurses */}
        {showQuickVitals && canTriage && (
          <div className="border-t border-[var(--line)] pt-2 mt-0.5">
            <p className="eyebrow text-[10px] text-[var(--ink-faint)] mb-1.5">{t("quickVitals")}</p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-0.5">
                <Label className="text-[10px]">{t("bpShort")}</Label>
                <Input
                  className="h-7 text-xs w-24"
                  placeholder="120/80"
                  value={qv.bp}
                  onChange={e => setQuickVitals(prev => ({ ...prev, [appt.id]: { ...qv, bp: e.target.value } }))}
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px]">{t("tempCelsius")}</Label>
                <Input
                  className="h-7 text-xs w-20"
                  type="number"
                  step="0.1"
                  placeholder="36.6"
                  value={qv.temp}
                  onChange={e => setQuickVitals(prev => ({ ...prev, [appt.id]: { ...qv, temp: e.target.value } }))}
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px]">{t("pulse")}</Label>
                <Input
                  className="h-7 text-xs w-20"
                  type="number"
                  placeholder="75"
                  value={qv.pulse}
                  onChange={e => setQuickVitals(prev => ({ ...prev, [appt.id]: { ...qv, pulse: e.target.value } }))}
                />
              </div>
              <button
                className="btn btn-sm btn-primary h-7 text-xs px-3"
                disabled={quickSaving === appt.id || (!qv.bp && !qv.temp && !qv.pulse)}
                onClick={() => handleQuickVitalsSave(appt)}
              >
                {quickSaving === appt.id ? t("saving") : t("save")}
              </button>
              <button
                className="btn btn-sm btn-outline h-7 text-xs px-2"
                onClick={() => handleContinueTriage(appt)}
              >
                {t("moreFields")}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="page">

      <div className="mb-4">
        <Input
          className="h-8 text-sm max-w-xs"
          placeholder={t("searchByPatientOrMrn")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Waiting (checked_in) */}
        <div className="card">
          <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" />
            <span className="font-semibold text-[var(--ink)] text-[13px]">{t("waitingForTriage")}</span>
            <span className="badge ms-auto">{waiting.length}</span>
          </div>
          <div className="card-pad space-y-2">
            {isLoading && <p className="text-[12px] text-[var(--ink-muted)]">{t("loading")}</p>}
            {!isLoading && waiting.length === 0 && <p className="text-[12px] text-[var(--ink-muted)]">{t("noPatientsWaiting")}</p>}
            {waiting.map(appt => (
              <AppointmentCard key={appt.id} appt={appt} action={
                canTriage ? (
                  <button className="btn btn-sm btn-primary h-7 text-xs px-3" onClick={() => handleStartTriage(appt)}>
                    <ArrowRight className="w-3 h-3 me-1" /> {t("startAction")}
                  </button>
                ) : undefined
              } />
            ))}
          </div>
        </div>

        {/* In Triage */}
        <div className="card">
          <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="font-semibold text-[var(--ink)] text-[13px]">{t("in_triage")}</span>
            <span className="badge ms-auto">{inTriage.length}</span>
          </div>
          <div className="card-pad space-y-2">
            {!isLoading && inTriage.length === 0 && <p className="text-[12px] text-[var(--ink-muted)]">{t("noPatientsInTriage")}</p>}
            {inTriage.map(appt => (
              <AppointmentCard key={appt.id} appt={appt} showQuickVitals action={
                canTriage ? (
                  <button className="btn btn-sm btn-outline h-7 text-xs px-3" onClick={() => handleContinueTriage(appt)}>
                    <ClipboardList className="w-3 h-3 me-1" /> {t("fullVitals")}
                  </button>
                ) : undefined
              } />
            ))}
          </div>
        </div>

        {/* Ready for Doctor */}
        <div className="card">
          <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0" />
            <span className="font-semibold text-[var(--ink)] text-[13px]">{t("ready_for_doctor")}</span>
            <span className="badge ms-auto">{readyForDoctor.length}</span>
          </div>
          <div className="card-pad space-y-2">
            {!isLoading && readyForDoctor.length === 0 && <p className="text-[12px] text-[var(--ink-muted)]">{t("noPatientsReady")}</p>}
            {readyForDoctor.map(appt => (
              <AppointmentCard key={appt.id} appt={appt} />
            ))}
          </div>
        </div>
      </div>

      {/* Full Vitals Dialog */}
      <Dialog open={!!selectedAppt} onOpenChange={open => { if (!open) setSelectedAppt(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-[var(--teal-600)]" />
              {t("recordVitals")} — {selectedAppt?.patient?.fullName}
            </DialogTitle>
          </DialogHeader>

          {selectedAppt?.patient?.allergies && (
            <div className="flex items-center gap-2 p-3 rounded-lg border"
              style={{ borderColor: "var(--rose-200)", background: "var(--rose-50)", color: "var(--rose-700)" }}>
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <div>
                <p className="text-xs font-semibold">{t("allergiesContraindications")}</p>
                <p className="text-sm">{selectedAppt.patient.allergies}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("bloodPressure")}</Label>
              <Input className="h-8 text-sm" placeholder="120/80" value={vitals.bloodPressure} onChange={e => setVitals(v => ({ ...v, bloodPressure: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("heartRate")}</Label>
              <Input className="h-8 text-sm" type="number" placeholder="75" value={vitals.heartRate} onChange={e => setVitals(v => ({ ...v, heartRate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("temperature")}</Label>
              <Input className="h-8 text-sm" type="number" step="0.1" placeholder="36.6" value={vitals.temperature} onChange={e => setVitals(v => ({ ...v, temperature: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("oxygenSaturation")}</Label>
              <Input className="h-8 text-sm" type="number" placeholder="98" value={vitals.oxygenSaturation} onChange={e => setVitals(v => ({ ...v, oxygenSaturation: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("weight")}</Label>
              <Input className="h-8 text-sm" type="number" step="0.1" placeholder="70" value={vitals.weight} onChange={e => setVitals(v => ({ ...v, weight: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("height")}</Label>
              <Input className="h-8 text-sm" type="number" placeholder="170" value={vitals.height} onChange={e => setVitals(v => ({ ...v, height: e.target.value }))} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">{t("nurseNotes")}</Label>
              <Input className="h-8 text-sm" placeholder={t("additionalObservations")} value={vitals.notes} onChange={e => setVitals(v => ({ ...v, notes: e.target.value }))} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button className="btn btn-sm btn-outline" onClick={() => setSelectedAppt(null)}>{t("cancel")}</button>
            <button className="btn btn-sm btn-primary" onClick={handleCompleteVitals} disabled={loading}>
              {loading ? t("saving") : t("completeTriageReady")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Triage() {
  return <TriageWorkflow />;
}
