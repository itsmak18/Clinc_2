import { useState } from "react";
import { useListMedicalRecords, useCreateMedicalRecord, useListPatients, useListUsers, getListMedicalRecordsQueryKey, getListPatientsQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { Plus } from "lucide-react";

export default function MedicalRecords() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    patientId: "", doctorId: "", chiefComplaint: "", diagnosis: "", treatment: "", notes: "",
    bloodPressure: "", heartRate: "", temperature: "", weight: "", height: "", oxygenSaturation: ""
  });

  const { data: records, isLoading } = useListMedicalRecords({}, { query: { queryKey: getListMedicalRecordsQueryKey({}) } });
  const { data: patients } = useListPatients({ limit: 200, offset: 0 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200, offset: 0 }) } });
  const { data: doctors } = useListUsers({ role: "doctor" as any }, { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } });

  const createMutation = useCreateMedicalRecord({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListMedicalRecordsQueryKey() });
        setShowCreate(false);
        toast({ title: "Medical record created" });
      },
      onError: () => toast({ title: "Failed to create record", variant: "destructive" }),
    }
  });

  const handleSave = () => {
    const vitals = {
      bloodPressure: form.bloodPressure || undefined,
      heartRate: form.heartRate ? parseInt(form.heartRate) : undefined,
      temperature: form.temperature ? parseFloat(form.temperature) : undefined,
      weight: form.weight ? parseFloat(form.weight) : undefined,
      height: form.height ? parseFloat(form.height) : undefined,
      oxygenSaturation: form.oxygenSaturation ? parseFloat(form.oxygenSaturation) : undefined,
    };
    createMutation.mutate({ data: { patientId: parseInt(form.patientId), doctorId: parseInt(form.doctorId), chiefComplaint: form.chiefComplaint, diagnosis: form.diagnosis, treatment: form.treatment, notes: form.notes || undefined, vitals } as any });
  };

  return (
    <div>
      <PageHeader
        title={t("medicalRecords")}
        subtitle={`${records?.length ?? 0} records`}
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-record">
            <Plus className="w-3.5 h-3.5 me-1" /> New Record
          </Button>
        }
      />
      <div className="p-6">
        <div className="flex gap-3 mb-4">
          <Input
            className="h-8 text-sm max-w-xs"
            placeholder="Search by patient, diagnosis, complaint…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={(records ?? []).filter(r => {
              if (!search) return true;
              const q = search.toLowerCase();
              return (
                r.patient?.fullName?.toLowerCase().includes(q) ||
                r.diagnosis?.toLowerCase().includes(q) ||
                r.chiefComplaint?.toLowerCase().includes(q)
              );
            })}
            emptyMessage="No medical records"
            columns={[
              { key: "patient", header: "Patient", render: r => <span className="font-medium text-sm">{r.patient?.fullName || `#${r.patientId}`}</span> },
              { key: "doctor", header: t("doctorLabel"), render: r => <span className="text-sm">{r.doctor?.fullName || `#${r.doctorId}`}</span> },
              { key: "complaint", header: t("chiefComplaint"), render: r => <span className="text-sm max-w-[200px] truncate block">{r.chiefComplaint}</span> },
              { key: "diagnosis", header: t("diagnosis"), render: r => <span className="text-sm max-w-[200px] truncate block">{r.diagnosis}</span> },
              { key: "date", header: t("date"), render: r => <span className="text-sm">{formatDate(r.createdAt)}</span> },
            ]}
          />
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Medical Record</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Patient *</Label>
                <Select value={form.patientId} onValueChange={v => setForm(f => ({ ...f, patientId: v }))}>
                  <SelectTrigger data-testid="select-patient"><SelectValue placeholder="Select patient" /></SelectTrigger>
                  <SelectContent>{patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("doctorLabel")} *</Label>
                <Select value={form.doctorId} onValueChange={v => setForm(f => ({ ...f, doctorId: v }))}>
                  <SelectTrigger data-testid="select-doctor"><SelectValue placeholder="Select doctor" /></SelectTrigger>
                  <SelectContent>{doctors?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
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
            <div>
              <Label className="text-xs font-semibold">{t("vitals")}</Label>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {[
                  { label: t("bloodPressure"), key: "bloodPressure", placeholder: "120/80" },
                  { label: t("heartRate"), key: "heartRate", placeholder: "72" },
                  { label: t("temperature"), key: "temperature", placeholder: "37.0" },
                  { label: t("weight"), key: "weight", placeholder: "70" },
                  { label: t("height"), key: "height", placeholder: "175" },
                  { label: t("oxygenSaturation"), key: "oxygenSaturation", placeholder: "98" },
                ].map(v => (
                  <div key={v.key} className="space-y-1">
                    <Label className="text-[10px]">{v.label}</Label>
                    <Input className="h-7 text-xs" placeholder={v.placeholder} value={(form as any)[v.key]} onChange={e => setForm(f => ({ ...f, [v.key]: e.target.value }))} />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={handleSave} disabled={createMutation.isPending} data-testid="button-save-record">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
