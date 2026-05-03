import { useState } from "react";
import { useListPrescriptions, useCreatePrescription, useListPatients, useListUsers, getListPrescriptionsQueryKey, getListPatientsQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { Plus, Trash2, AlertTriangle, Printer } from "lucide-react";
import { openPrintWindow, prescriptionHtml } from "@/lib/print";

interface Medication { name: string; dosage: string; frequency: string; duration: string; instructions: string; }

export default function Prescriptions() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = user?.role === "super_admin" || user?.role === "admin" || user?.role === "doctor";
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [medications, setMedications] = useState<Medication[]>([{ name: "", dosage: "", frequency: "", duration: "", instructions: "" }]);
  const [printRx, setPrintRx] = useState<(typeof prescriptions extends (infer U)[] | undefined ? U : never) | null>(null);

  const { data: prescriptions, isLoading } = useListPrescriptions({}, { query: { queryKey: getListPrescriptionsQueryKey({}) } });
  const { data: patients } = useListPatients({ limit: 200, offset: 0 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200, offset: 0 }) } });
  const { data: doctors } = useListUsers({ role: "doctor" as any }, { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } });

  const createMutation = useCreatePrescription({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPrescriptionsQueryKey() });
        setShowCreate(false);
        setMedications([{ name: "", dosage: "", frequency: "", duration: "", instructions: "" }]);
        toast({ title: "Prescription created" });
      },
      onError: () => toast({ title: "Failed", variant: "destructive" }),
    }
  });

  return (
    <div>
      <PageHeader
        title={t("prescriptions")}
        subtitle={`${prescriptions?.length ?? 0} prescriptions`}
        actions={canWrite ? (
          <Button size="sm" onClick={() => setShowCreate(true)} data-testid="button-create-prescription">
            <Plus className="w-3.5 h-3.5 me-1" /> New Prescription
          </Button>
        ) : undefined}
      />
      <div className="p-6">
        <div className="flex gap-3 mb-4">
          <Input
            className="h-8 text-sm max-w-xs"
            placeholder="Search by patient or medication…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={(prescriptions ?? []).filter(p => {
              if (!search) return true;
              const q = search.toLowerCase();
              return (
                p.patient?.fullName?.toLowerCase().includes(q) ||
                (p.medications as any[])?.some((m: any) => m.name?.toLowerCase().includes(q))
              );
            })}
            emptyMessage="No prescriptions"
            columns={[
              { key: "patient", header: "Patient", render: p => (
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm">{p.patient?.fullName || `#${p.patientId}`}</span>
                    {(p.patient as any)?.allergies && (
                      <span title={`Allergies: ${(p.patient as any).allergies}`}>
                        <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0" />
                      </span>
                    )}
                  </div>
                  {(p.patient as any)?.allergies && (
                    <div className="text-xs text-destructive mt-0.5 truncate max-w-[180px]">
                      ⚠ {(p.patient as any).allergies}
                    </div>
                  )}
                </div>
              )},
              { key: "doctor", header: t("doctorLabel"), render: p => <span className="text-sm">{p.doctor?.fullName || `#${p.doctorId}`}</span> },
              { key: "meds", header: t("medications"), render: p => <span className="text-sm">{(p.medications as any[])?.map((m: any) => m.name).join(", ") || "-"}</span> },
              { key: "date", header: t("date"), render: p => <span className="text-sm">{formatDate(p.createdAt)}</span> },
              { key: "print", header: "", render: p => (
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                  onClick={e => { e.stopPropagation(); openPrintWindow(prescriptionHtml(p as any), `Prescription - ${p.patient?.fullName ?? p.id}`); }}
                  title="Print prescription" data-testid={`button-print-rx-${p.id}`}>
                  <Printer className="w-3.5 h-3.5" />
                </Button>
              )},
            ]}
          />
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New Prescription</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Patient *</Label>
                <Select value={patientId} onValueChange={setPatientId}>
                  <SelectTrigger data-testid="select-patient"><SelectValue placeholder="Select patient" /></SelectTrigger>
                  <SelectContent>{patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("doctorLabel")} *</Label>
                <Select value={doctorId} onValueChange={setDoctorId}>
                  <SelectTrigger data-testid="select-doctor"><SelectValue placeholder="Select doctor" /></SelectTrigger>
                  <SelectContent>{doctors?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">{t("medications")}</Label>
              <div className="space-y-3 mt-2">
                {medications.map((med, idx) => (
                  <div key={idx} className="border border-border rounded p-3 relative">
                    <Button size="sm" variant="ghost" className="absolute top-2 end-2 h-6 w-6 p-0 text-destructive" onClick={() => setMedications(prev => prev.filter((_, i) => i !== idx))}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "Drug Name *", key: "name" },
                        { label: t("dosage") + " *", key: "dosage" },
                        { label: t("frequency") + " *", key: "frequency" },
                        { label: t("duration") + " *", key: "duration" },
                        { label: t("instructions"), key: "instructions" },
                      ].map(f => (
                        <div key={f.key} className="space-y-1">
                          <Label className="text-[10px]">{f.label}</Label>
                          <Input className="h-7 text-xs" value={(med as any)[f.key]} onChange={e => setMedications(prev => prev.map((m, i) => i === idx ? { ...m, [f.key]: e.target.value } : m))} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMedications(prev => [...prev, { name: "", dosage: "", frequency: "", duration: "", instructions: "" }])} data-testid="button-add-medication">
                  <Plus className="w-3 h-3 me-1" />{t("addMedication")}
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>{t("cancel")}</Button>
              <Button size="sm" onClick={() => createMutation.mutate({ data: { patientId: parseInt(patientId), doctorId: parseInt(doctorId), medications: medications as any } as any })} disabled={createMutation.isPending} data-testid="button-save-prescription">
                {createMutation.isPending ? t("loading") : t("save")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
