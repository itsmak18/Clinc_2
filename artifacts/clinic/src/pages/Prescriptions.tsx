import { useState } from "react";
import { useListPrescriptions, useCreatePrescription, useListPatients, useListUsers, getListPrescriptionsQueryKey, getListPatientsQueryKey, getListUsersQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
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
  const [notes, setNotes] = useState("");
  const [notesAr, setNotesAr] = useState("");
  const [showArCreate, setShowArCreate] = useState(false);
  const [medications, setMedications] = useState<Medication[]>([{ name: "", dosage: "", frequency: "", duration: "", instructions: "" }]);

  const { data: prescriptions, isLoading } = useListPrescriptions({}, { query: { queryKey: getListPrescriptionsQueryKey({}) } });
  const { data: patients } = useListPatients({ limit: 200 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200 }) } });
  const { data: doctors } = useListUsers({ role: "doctor" as any }, { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } });

  const createMutation = useCreatePrescription({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListPrescriptionsQueryKey() });
        setShowCreate(false);
        setMedications([{ name: "", dosage: "", frequency: "", duration: "", instructions: "" }]);
        setNotes(""); setNotesAr("");
        toast({ title: t("prescriptionCreated") });
      },
      onError: (err: any) => toast({
        title: err?.data?.error_code === 3010 ? t("consentRequiredHint") : t("failed"),
        variant: "destructive",
      }),
    },
  });

  return (
    <div className="page">
      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Input
          className="h-8 text-sm max-w-xs"
          placeholder={t("searchByPatientOrMedication")}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {canWrite && (
          <button className="btn btn-primary btn-sm gap-1.5 ms-auto" onClick={() => setShowCreate(true)} data-testid="button-create-prescription">
            <Plus className="w-3.5 h-3.5" /> {t("newPrescription")}
          </button>
        )}
      </div>

      <div className="card overflow-hidden">
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
          emptyMessage={t("noPrescriptions")}
          columns={[
            {
              key: "patient",
              header: t("patient"),
              render: p => (
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-[13px] text-[var(--ink)]">{p.patient?.fullName || `#${p.patientId}`}</span>
                    {(p.patient as any)?.allergies && (
                      <span title={`Allergies: ${(p.patient as any).allergies}`}>
                        <AlertTriangle className="w-3.5 h-3.5 text-[var(--rose-500)] flex-shrink-0" />
                      </span>
                    )}
                  </div>
                  {(p.patient as any)?.allergies && (
                    <div className="text-[11px] text-[var(--rose-500)] mt-0.5 truncate max-w-[180px]">
                      ⚠ {(p.patient as any).allergies}
                    </div>
                  )}
                </div>
              ),
            },
            { key: "doctor", header: t("doctorLabel"), render: p => <span className="text-[13px] text-[var(--ink)]">{p.doctor?.fullName || `#${p.doctorId}`}</span> },
            {
              key: "meds",
              header: t("medications"),
              render: p => <span className="text-[13px] text-[var(--ink)]">{(p.medications as any[])?.map((m: any) => m.name).join(", ") || "—"}</span>,
            },
            { key: "date",  header: t("date"), render: p => <span className="text-[12px] text-[var(--ink-muted)]">{formatDate(p.createdAt)}</span> },
            {
              key: "print",
              header: "",
              render: p => (
                <button
                  className="btn btn-ghost btn-sm h-7 w-7 p-0 text-[var(--ink-muted)]"
                  onClick={e => { e.stopPropagation(); openPrintWindow(prescriptionHtml(p as any), `Prescription - ${p.patient?.fullName ?? p.id}`); }}
                  title={t("printPrescription")}
                  data-testid={`button-print-rx-${p.id}`}
                >
                  <Printer className="w-3.5 h-3.5" />
                </button>
              ),
            },
          ]}
        />
      </div>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("newPrescription")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("patient")} *</Label>
                <Select value={patientId} onValueChange={setPatientId}>
                  <SelectTrigger data-testid="select-patient"><SelectValue placeholder={t("selectPatient")} /></SelectTrigger>
                  <SelectContent>{patients?.patients?.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.fullName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("doctorLabel")} *</Label>
                <Select value={doctorId} onValueChange={setDoctorId}>
                  <SelectTrigger data-testid="select-doctor"><SelectValue placeholder={t("selectDoctor")} /></SelectTrigger>
                  <SelectContent>{doctors?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label className="text-xs font-semibold">{t("medications")}</Label>
              <div className="space-y-3 mt-2">
                {medications.map((med, idx) => (
                  <div key={idx} className="border border-[var(--line)] rounded-lg p-3 relative">
                    <button
                      className="absolute top-2 end-2 btn btn-ghost btn-sm h-6 w-6 p-0 text-[var(--rose-500)]"
                      onClick={() => setMedications(prev => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: t("drugName") + " *", key: "name" },
                        { label: t("dosage") + " *",   key: "dosage" },
                        { label: t("frequency") + " *", key: "frequency" },
                        { label: t("duration") + " *",  key: "duration" },
                        { label: t("instructions"),      key: "instructions" },
                      ].map(f => (
                        <div key={f.key} className="space-y-1">
                          <Label className="text-[10px]">{f.label}</Label>
                          <Input
                            className="h-7 text-xs"
                            value={(med as any)[f.key]}
                            onChange={e => setMedications(prev => prev.map((m, i) => i === idx ? { ...m, [f.key]: e.target.value } : m))}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <button
                  className="btn btn-outline btn-sm h-7 text-xs gap-1"
                  onClick={() => setMedications(prev => [...prev, { name: "", dosage: "", frequency: "", duration: "", instructions: "" }])}
                  data-testid="button-add-medication"
                >
                  <Plus className="w-3 h-3" />{t("addMedication")}

                </button>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">{t("notes")}</Label>
              <textarea
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
              />
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm h-7 text-xs gap-1.5 text-[var(--ink-muted)] w-full justify-start px-0"
              onClick={() => setShowArCreate(v => !v)}
            >
              <span className="text-base leading-none">ع</span> {t("arabicFields")}
            </button>
            {showArCreate && (
              <div className="space-y-1 border border-[var(--line)] rounded-lg p-3 bg-[var(--surface-2)]" dir="rtl">
                <Label className="text-xs">{t("notesAr")}</Label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[60px] resize-none text-right focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={notesAr}
                  onChange={e => setNotesAr(e.target.value)}
                  rows={2}
                />
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => createMutation.mutate({ data: { patientId: parseInt(patientId), doctorId: parseInt(doctorId), medications: medications as any, notes: notes || undefined, notesAr: notesAr || undefined } as any })}
                disabled={createMutation.isPending}
                data-testid="button-save-prescription"
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
