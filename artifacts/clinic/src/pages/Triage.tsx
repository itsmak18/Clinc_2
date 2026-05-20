import { useState } from "react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetTodayAppointments,
  useStartTriage,
  useMarkPatientReady,
  useUpdateAppointment,
  useCreateMedicalRecord,
  getGetTodayAppointmentsQueryKey,
  getListAppointmentsQueryKey,
} from "@workspace/api-client-react";
import PageHeader from "@/components/PageHeader";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
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

const PRIORITY_STYLES: Record<Priority, { pill: string; border: string; label: string }> = {
  normal:   { pill: "bg-muted text-muted-foreground",                          border: "border-border",         label: "Normal"   },
  urgent:   { pill: "bg-orange-100 text-orange-700 border border-orange-300",  border: "border-orange-400",     label: "Urgent"   },
  critical: { pill: "bg-destructive/15 text-destructive border border-destructive/40", border: "border-destructive", label: "Critical" },
};

const PRIORITY_ORDER: Record<Priority, number> = { critical: 0, urgent: 1, normal: 2 };

function sortByPriority(appts: any[]): any[] {
  return [...appts].sort((a, b) => {
    const pa = PRIORITY_ORDER[(a.triagePriority as Priority) ?? "normal"] ?? 2;
    const pb = PRIORITY_ORDER[(b.triagePriority as Priority) ?? "normal"] ?? 2;
    if (pa !== pb) return pa - pb;
    return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
  });
}

export default function Triage() {
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
    mutation: { onSuccess: () => invalidate(), onError: () => toast({ title: "Failed to start triage", variant: "destructive" }) },
  });
  const updateAppointmentMutation = useUpdateAppointment({
    mutation: { onSuccess: () => invalidate(), onError: () => toast({ title: "Failed to update priority", variant: "destructive" }) },
  });
  const createMedicalRecordMutation = useCreateMedicalRecord();
  const markReadyMutation = useMarkPatientReady();

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
      await createMedicalRecordMutation.mutateAsync({
        data: {
          patientId: appt.patientId,
          doctorId: appt.doctorId,
          appointmentId: appt.id,
          chiefComplaint: "Quick vitals recorded",
          diagnosis: "Pending — triage only",
          treatment: "Pending",
          vitals: {
            bloodPressure: qv.bp || undefined,
            heartRate: qv.pulse ? parseInt(qv.pulse) : undefined,
            temperature: qv.temp ? parseFloat(qv.temp) : undefined,
          },
        } as any,
      });
      toast({ title: "Quick vitals saved" });
      setQuickVitals(prev => { const next = { ...prev }; delete next[appt.id]; return next; });
    } catch {
      toast({ title: "Failed to save vitals", variant: "destructive" });
    } finally {
      setQuickSaving(null);
    }
  };

  const handleCompleteVitals = async () => {
    if (!selectedAppt) return;
    setLoading(true);
    try {
      const vitalsData = {
        bloodPressure: vitals.bloodPressure || undefined,
        heartRate: vitals.heartRate ? parseInt(vitals.heartRate) : undefined,
        temperature: vitals.temperature ? parseFloat(vitals.temperature) : undefined,
        weight: vitals.weight ? parseFloat(vitals.weight) : undefined,
        height: vitals.height ? parseFloat(vitals.height) : undefined,
        oxygenSaturation: vitals.oxygenSaturation ? parseFloat(vitals.oxygenSaturation) : undefined,
      };

      await createMedicalRecordMutation.mutateAsync({
        data: {
          patientId: selectedAppt.patientId,
          doctorId: selectedAppt.doctorId,
          appointmentId: selectedAppt.id,
          chiefComplaint: "Triage vitals recorded",
          diagnosis: "Pending — triage only",
          treatment: "Pending",
          notes: vitals.notes || undefined,
          vitals: vitalsData,
        } as any,
      });

      await markReadyMutation.mutateAsync({ appointmentId: selectedAppt.id });
      toast({ title: "Vitals recorded — patient is ready for doctor" });
      setSelectedAppt(null);
      invalidate();
    } catch {
      toast({ title: "Failed to complete triage", variant: "destructive" });
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
              current === p ? PRIORITY_STYLES[p].pill : "bg-muted/50 text-muted-foreground/60 hover:opacity-80"
            )}
          >
            {PRIORITY_STYLES[p].label}
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
        "flex flex-col gap-2 p-3 rounded-lg border-l-4 bg-card hover:bg-muted/30 transition-colors",
        styles.border
      )}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <User className="w-4 h-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm truncate">{appt.patient?.fullName || `Patient #${appt.patientId}`}</p>
            <p className="text-xs text-muted-foreground font-mono">{appt.patient?.mrn}</p>
            <p className="text-xs text-muted-foreground truncate">{appt.doctor?.fullName}</p>
            {appt.patient?.allergies && (
              <div className="flex items-center gap-1 mt-0.5">
                <AlertTriangle className="w-3 h-3 text-destructive shrink-0" />
                <p className="text-xs text-destructive truncate">{appt.patient.allergies}</p>
              </div>
            )}
            {canTriage && <PriorityToggle appt={appt} />}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {priority !== "normal" && (
              <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-semibold", styles.pill)}>
                {styles.label}
              </span>
            )}
            <StatusBadge status={appt.status} />
            {action}
          </div>
        </div>

        {/* Inline Quick Vitals — only on in_triage cards for nurses */}
        {showQuickVitals && canTriage && (
          <div className="border-t border-border/50 pt-2 mt-0.5">
            <p className="text-[10px] text-muted-foreground mb-1.5 font-medium uppercase tracking-wide">Quick Vitals</p>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-0.5">
                <Label className="text-[10px]">BP</Label>
                <Input
                  className="h-7 text-xs w-24"
                  placeholder="120/80"
                  value={qv.bp}
                  onChange={e => setQuickVitals(prev => ({ ...prev, [appt.id]: { ...qv, bp: e.target.value } }))}
                />
              </div>
              <div className="space-y-0.5">
                <Label className="text-[10px]">Temp °C</Label>
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
                <Label className="text-[10px]">Pulse</Label>
                <Input
                  className="h-7 text-xs w-20"
                  type="number"
                  placeholder="75"
                  value={qv.pulse}
                  onChange={e => setQuickVitals(prev => ({ ...prev, [appt.id]: { ...qv, pulse: e.target.value } }))}
                />
              </div>
              <Button
                size="sm"
                className="h-7 text-xs px-3"
                disabled={quickSaving === appt.id || (!qv.bp && !qv.temp && !qv.pulse)}
                onClick={() => handleQuickVitalsSave(appt)}
              >
                {quickSaving === appt.id ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs px-2"
                onClick={() => handleContinueTriage(appt)}
              >
                More fields
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title="Triage Queue"
        subtitle="Manage patient vitals before doctor consultation"
      />

      <div className="px-6 pt-4 pb-0">
        <Input
          className="h-8 text-sm max-w-xs"
          placeholder="Search by patient name or MRN…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="p-6 grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Waiting (checked_in) */}
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-500" />
              Waiting for Triage
              <Badge variant="secondary" className="ms-auto">{waiting.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {isLoading && <p className="text-xs text-muted-foreground">{t("loading")}</p>}
            {!isLoading && waiting.length === 0 && <p className="text-xs text-muted-foreground">No patients waiting</p>}
            {waiting.map(appt => (
              <AppointmentCard key={appt.id} appt={appt} action={
                canTriage ? (
                  <Button size="sm" className="h-7 text-xs px-3" onClick={() => handleStartTriage(appt)}>
                    <ArrowRight className="w-3 h-3 me-1" /> Start
                  </Button>
                ) : undefined
              } />
            ))}
          </CardContent>
        </Card>

        {/* In Triage */}
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              In Triage
              <Badge variant="secondary" className="ms-auto">{inTriage.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {!isLoading && inTriage.length === 0 && <p className="text-xs text-muted-foreground">No patients in triage</p>}
            {inTriage.map(appt => (
              <AppointmentCard key={appt.id} appt={appt} showQuickVitals action={
                canTriage ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs px-3" onClick={() => handleContinueTriage(appt)}>
                    <ClipboardList className="w-3 h-3 me-1" /> Full Vitals
                  </Button>
                ) : undefined
              } />
            ))}
          </CardContent>
        </Card>

        {/* Ready for Doctor */}
        <Card className="border border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              Ready for Doctor
              <Badge variant="secondary" className="ms-auto">{readyForDoctor.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            {!isLoading && readyForDoctor.length === 0 && <p className="text-xs text-muted-foreground">No patients ready</p>}
            {readyForDoctor.map(appt => (
              <AppointmentCard key={appt.id} appt={appt} />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Full Vitals Dialog */}
      <Dialog open={!!selectedAppt} onOpenChange={open => { if (!open) setSelectedAppt(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              Record Vitals — {selectedAppt?.patient?.fullName}
            </DialogTitle>
          </DialogHeader>

          {selectedAppt?.patient?.allergies && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/30">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
              <div>
                <p className="text-xs font-semibold text-destructive">ALLERGIES / CONTRAINDICATIONS</p>
                <p className="text-sm text-destructive">{selectedAppt.patient.allergies}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Blood Pressure (e.g. 120/80)</Label>
              <Input className="h-8 text-sm" placeholder="120/80" value={vitals.bloodPressure} onChange={e => setVitals(v => ({ ...v, bloodPressure: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Heart Rate (bpm)</Label>
              <Input className="h-8 text-sm" type="number" placeholder="75" value={vitals.heartRate} onChange={e => setVitals(v => ({ ...v, heartRate: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Temperature (°C)</Label>
              <Input className="h-8 text-sm" type="number" step="0.1" placeholder="36.6" value={vitals.temperature} onChange={e => setVitals(v => ({ ...v, temperature: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">O₂ Saturation (%)</Label>
              <Input className="h-8 text-sm" type="number" placeholder="98" value={vitals.oxygenSaturation} onChange={e => setVitals(v => ({ ...v, oxygenSaturation: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Weight (kg)</Label>
              <Input className="h-8 text-sm" type="number" step="0.1" placeholder="70" value={vitals.weight} onChange={e => setVitals(v => ({ ...v, weight: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Height (cm)</Label>
              <Input className="h-8 text-sm" type="number" placeholder="170" value={vitals.height} onChange={e => setVitals(v => ({ ...v, height: e.target.value }))} />
            </div>
            <div className="space-y-1 col-span-2">
              <Label className="text-xs">Nurse Notes</Label>
              <Input className="h-8 text-sm" placeholder="Additional observations..." value={vitals.notes} onChange={e => setVitals(v => ({ ...v, notes: e.target.value }))} />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={() => setSelectedAppt(null)}>Cancel</Button>
            <Button size="sm" onClick={handleCompleteVitals} disabled={loading}>
              {loading ? "Saving..." : "Complete Triage → Ready for Doctor"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
