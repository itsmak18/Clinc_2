import { useState } from "react";
import { useListPatients, useCreateMedicalRecord, useListUsers, getListPatientsQueryKey, getListUsersQueryKey, getListMedicalRecordsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import VitalChip from "@/components/VitalChip";
import { Activity, Save } from "lucide-react";

interface VitalsForm {
  patientId: string;
  doctorId: string;
  bloodPressure: string;
  heartRate: string;
  temperature: string;
  oxygenSaturation: string;
  respiratoryRate: string;
  glucose: string;
  pain: number;
}

const EMPTY: VitalsForm = {
  patientId: "", doctorId: "", bloodPressure: "", heartRate: "", temperature: "",
  oxygenSaturation: "", respiratoryRate: "", glucose: "", pain: 0,
};

export default function NurseVitals() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<VitalsForm>(EMPTY);

  const { data: patients } = useListPatients({ limit: 200 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200 }) } });
  const { data: doctors }  = useListUsers({ role: "doctor" as any }, { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } });

  const createMutation = useCreateMedicalRecord({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMedicalRecordsQueryKey() });
        toast({ title: t("vitalsRecorded") });
        setForm(EMPTY);
      },
      onError: () => toast({ title: t("vitalsRecordFailed"), variant: "destructive" }),
    },
  });

  const canSubmit = form.patientId && form.doctorId && (
    form.bloodPressure || form.heartRate || form.temperature ||
    form.oxygenSaturation || form.respiratoryRate || form.glucose
  );

  const submit = () => {
    const vitals = {
      bloodPressure:    form.bloodPressure    || undefined,
      heartRate:        form.heartRate        ? parseInt(form.heartRate)            : undefined,
      temperature:      form.temperature      ? parseFloat(form.temperature)        : undefined,
      oxygenSaturation: form.oxygenSaturation ? parseFloat(form.oxygenSaturation)   : undefined,
      respiratoryRate:  form.respiratoryRate  ? parseInt(form.respiratoryRate)      : undefined,
      glucose:          form.glucose          ? parseFloat(form.glucose)            : undefined,
      pain:             form.pain,
    };
    createMutation.mutate({
      data: {
        patientId: parseInt(form.patientId),
        doctorId: parseInt(form.doctorId),
        chiefComplaint: t("rapidVitalsEntry"),
        diagnosis: t("rapidVitalsEntry"),
        treatment: `Pain: ${form.pain}/10`,
        notes: `Recorded by ${user?.fullName ?? "nurse"}`,
        vitals,
      } as any,
    });
  };

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <Activity className="w-5 h-5 text-[var(--teal-600)]" />
        <h1 className="font-semibold text-[var(--ink)] text-[15px]">{t("rapidVitalsEntry")}</h1>
      </div>

      <div className="card max-w-3xl">
        <div className="card-pad space-y-4">
          {/* Patient + doctor */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{t("patient")} *</Label>
              <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                <SelectTrigger aria-label={t("selectPatient")} data-testid="select-patient">
                  <SelectValue placeholder={t("selectPatient")} />
                </SelectTrigger>
                <SelectContent>
                  {patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("doctorLabel")} *</Label>
              <Select value={form.doctorId} onValueChange={v => setForm(f => ({ ...f, doctorId: v }))}>
                <SelectTrigger aria-label={t("selectDoctor2")} data-testid="select-doctor">
                  <SelectValue placeholder={t("selectDoctor2")} />
                </SelectTrigger>
                <SelectContent>
                  {doctors?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Vitals grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { key: "bloodPressure",    label: t("bloodPressure"),    placeholder: "120/80",  vitalKey: "bp"      },
              { key: "heartRate",        label: t("heartRate"),        placeholder: "72",      vitalKey: "hr"      },
              { key: "temperature",      label: t("temperature"),      placeholder: "37.0",    vitalKey: "temp"    },
              { key: "oxygenSaturation", label: t("oxygenSaturation"), placeholder: "98",      vitalKey: "spo2"    },
              { key: "respiratoryRate",  label: t("respiratoryRate"),  placeholder: "16",      vitalKey: "rr"      },
              { key: "glucose",          label: t("glucose"),          placeholder: "5.5",     vitalKey: "glucose" },
            ].map(v => {
              const val = (form as any)[v.key] as string;
              return (
                <div key={v.key} className="space-y-1">
                  <Label className="text-xs">{v.label}</Label>
                  <Input
                    className="h-9 text-sm"
                    placeholder={v.placeholder}
                    value={val}
                    onChange={e => setForm(f => ({ ...f, [v.key]: e.target.value }))}
                    data-testid={`input-${v.key}`}
                  />
                  {val && <VitalChip vitalKey={v.vitalKey as any} value={val} />}
                </div>
              );
            })}
          </div>

          {/* Pain slider */}
          <div className="space-y-1">
            <Label className="text-xs flex justify-between">
              <span>{t("painScale")}</span>
              <span className="font-mono text-[var(--ink)]">{form.pain}/10</span>
            </Label>
            <input
              type="range"
              min={0}
              max={10}
              step={1}
              value={form.pain}
              onChange={e => setForm(f => ({ ...f, pain: parseInt(e.target.value) }))}
              className="w-full"
              aria-label={t("painScale")}
              data-testid="input-pain"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--line)]">
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
  );
}
