import { useState } from "react";
import { useListPrescriptions, useCreatePrescription, useSendPrescriptionToPharmacy, useListPatients, getListPrescriptionsQueryKey, getListPatientsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useQueryClient } from "@tanstack/react-query";
import DataTable from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { formatDate, calcAge } from "@/lib/api";
import PatientSearchSelect from "@/components/PatientSearchSelect";
import { DetailSection, DetailGrid, DetailField } from "@/components/DetailView";
import { Plus, Trash2, AlertTriangle, Printer, ShieldCheck, Send } from "lucide-react";
import { openPrintWindow, prescriptionHtml, blankPrescriptionHtml } from "@/lib/print";
import { usePrintLang } from "@/hooks/printLang";

interface Medication { name: string; dosage: string; frequency: string; duration: string; instructions: string; }

export default function Prescriptions() {
  const { t } = useI18n();
  const choosePrintLang = usePrintLang();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canWrite = user?.role === "super_admin" || user?.role === "admin" || user?.role === "doctor";
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState("");
  const [patientId, setPatientId] = useState("");
  const [notes, setNotes] = useState("");
  const [notesAr, setNotesAr] = useState("");
  const [showArCreate, setShowArCreate] = useState(false);
  const [medications, setMedications] = useState<Medication[]>([{ name: "", dosage: "", frequency: "", duration: "", instructions: "" }]);

  const { data: prescriptions, isLoading } = useListPrescriptions({}, { query: { queryKey: getListPrescriptionsQueryKey({}) } });
  const { data: patients } = useListPatients({ limit: 200 }, { query: { queryKey: getListPatientsQueryKey({ limit: 200 }) } });

  // Read-only "view all information" detail — opened by clicking a row.
  const [viewRx, setViewRx] = useState<NonNullable<typeof prescriptions>[number] | null>(null);

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
        description: err?.data?.error_code === 3010 ? undefined : err?.data?.message,
        variant: "destructive",
      }),
    },
  });

  const sendToPharmacyMutation = useSendPrescriptionToPharmacy({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListPrescriptionsQueryKey() }); toast({ title: t("sentToPharmacy") }); },
      onError: (err: any) => toast({ title: t("failed"), description: err?.data?.message, variant: "destructive" }),
    },
  });

  // The prescriber is ALWAYS the signed-in user — not selectable, for any role.
  const validateForm = () => {
    const docId = user?.id ?? 0;
    const validMeds = medications.filter(m => m.name.trim());
    const missing = [
      !patientId && t("patient"),
      !docId && t("prescribingDoctor"),
      validMeds.length === 0 && t("medications"),
    ].filter(Boolean);
    if (missing.length) {
      toast({ title: t("fillRequiredFields"), description: missing.join("، "), variant: "destructive" });
      return null;
    }
    return { patientId: parseInt(patientId), doctorId: docId, medications: validMeds, notes: notes || undefined, notesAr: notesAr || undefined };
  };

  const handleSave = async (after: "print" | "pharmacy") => {
    const data = validateForm();
    if (!data) return;
    try {
      const created: any = await createMutation.mutateAsync({ data: data as any });
      if (after === "print") {
        const lang = await choosePrintLang();
        if (!lang) return;
        const selectedPatient = patients?.patients?.find(p => String(p.id) === String(data.patientId));
        openPrintWindow(
          prescriptionHtml({ ...created, patient: created.patient ?? selectedPatient, doctor: created.doctor ?? { id: user?.id, fullName: user?.fullName } } as any, lang),
          `Prescription - ${created.patient?.fullName ?? selectedPatient?.fullName ?? created.id}`,
        );
      } else {
        await sendToPharmacyMutation.mutateAsync({ prescriptionId: created.id });
      }
    } catch { /* create / send onError toasts already fired */ }
  };

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
          <div className="flex items-center gap-2 ms-auto">
            <button
              className="btn btn-outline btn-sm gap-1.5"
              onClick={async () => { const lang = await choosePrintLang(); if (!lang) return; openPrintWindow(blankPrescriptionHtml({ fullName: user?.fullName }, lang), "Blank Prescription"); }}
              title={t("blankPrescriptionHint")}
              data-testid="button-blank-prescription"
            >
              <Printer className="w-3.5 h-3.5" /> {t("blankPrescription")}
            </button>
            <button className="btn btn-primary btn-sm gap-1.5" onClick={() => setShowCreate(true)} data-testid="button-create-prescription">
              <Plus className="w-3.5 h-3.5" /> {t("newPrescription")}
            </button>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          onRowClick={p => setViewRx(p)}
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
                  {(p.patient as any)?.mrn && (
                    <div className="text-[11px] text-[var(--ink-muted)] font-mono mt-0.5">{(p.patient as any).mrn}</div>
                  )}
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
              key: "actions",
              header: "",
              render: p => (
                <div className="flex gap-1 justify-end">
                  <button
                    className="btn btn-ghost btn-sm h-7 w-7 p-0 text-[var(--ink-muted)]"
                    onClick={async e => { e.stopPropagation(); const lang = await choosePrintLang(); if (!lang) return; openPrintWindow(prescriptionHtml(p as any, lang), `Prescription - ${p.patient?.fullName ?? p.id}`); }}
                    title={t("printPrescription")}
                    data-testid={`button-print-rx-${p.id}`}
                  >
                    <Printer className="w-3.5 h-3.5" />
                  </button>
                  {canWrite && (
                    <button
                      className="btn btn-ghost btn-sm h-7 w-7 p-0 text-[var(--teal-600)]"
                      onClick={e => { e.stopPropagation(); sendToPharmacyMutation.mutate({ prescriptionId: p.id }); }}
                      title={t("sendToPharmacy")}
                      data-testid={`button-send-rx-${p.id}`}
                    >
                      <Send className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </div>

      {/* Read-only detail — all information for one prescription */}
      <Dialog open={!!viewRx} onOpenChange={o => !o && setViewRx(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("prescriptionDetails")}</DialogTitle></DialogHeader>
          {viewRx && (
            <div className="space-y-5">
              <DetailGrid cols={3}>
                <DetailField label={t("patient")} value={
                  <span className="inline-flex items-center gap-1.5">
                    {viewRx.patient?.fullName || `#${viewRx.patientId}`}
                    {(viewRx.patient as any)?.allergies && (
                      <span title={`${t("allergies")}: ${(viewRx.patient as any).allergies}`}>
                        <AlertTriangle className="w-3.5 h-3.5 text-[var(--rose-500)]" />
                      </span>
                    )}
                  </span>
                } />
                <DetailField label={t("mrn")} value={(viewRx.patient as any)?.mrn} mono />
                <DetailField label={t("dateOfBirth")} value={
                  (viewRx.patient as any)?.dateOfBirth
                    ? `${formatDate((viewRx.patient as any).dateOfBirth)} (${calcAge((viewRx.patient as any).dateOfBirth)})`
                    : null
                } />
                <DetailField label={t("gender")} value={(viewRx.patient as any)?.gender
                  ? <span className="capitalize">{t((viewRx.patient as any).gender as any)}</span> : null} />
                <DetailField label={t("prescribingDoctor")} value={viewRx.doctor?.fullName || `#${viewRx.doctorId}`} />
                <DetailField label={t("date")} value={formatDate(viewRx.createdAt)} />
              </DetailGrid>

              {(viewRx.patient as any)?.allergies && (
                <div className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12px]" style={{ background: "var(--rose-50)", color: "var(--rose-500)" }}>
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span><b>{t("allergies")}:</b> {(viewRx.patient as any).allergies}</span>
                </div>
              )}

              <DetailSection title={t("medications")}>
                <div className="space-y-2">
                  {((viewRx.medications as any[]) ?? []).map((m: any, i: number) => (
                    <div key={i} className="border border-[var(--line)] rounded-lg p-3">
                      <div className="font-medium text-[13px] text-[var(--ink)]">{m.name}</div>
                      <div className="text-[12px] text-[var(--ink-soft)] mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                        {m.dosage && <span><span className="text-[var(--ink-muted)]">{t("dosage")}:</span> {m.dosage}</span>}
                        {m.frequency && <span><span className="text-[var(--ink-muted)]">{t("frequency")}:</span> {m.frequency}</span>}
                        {m.duration && <span><span className="text-[var(--ink-muted)]">{t("duration")}:</span> {m.duration}</span>}
                      </div>
                      {m.instructions && (
                        <div className="text-[12px] text-[var(--ink-soft)] mt-1">
                          <span className="text-[var(--ink-muted)]">{t("instructions")}:</span> {m.instructions}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </DetailSection>

              {(viewRx.notes || (viewRx as any).notesAr) && (
                <DetailSection>
                  <DetailField label={t("notes")} value={viewRx.notes} secondary={(viewRx as any).notesAr} full />
                </DetailSection>
              )}

              <div className="flex justify-between gap-2 pt-1">
                <button
                  className="btn btn-outline btn-sm gap-1.5"
                  onClick={async () => { const lang = await choosePrintLang(); if (!lang) return; openPrintWindow(prescriptionHtml(viewRx as any, lang), `Prescription - ${viewRx.patient?.fullName ?? viewRx.id}`); }}
                  data-testid="button-print-rx-detail"
                >
                  <Printer className="w-3.5 h-3.5" /> {t("printPrescription")}
                </button>
                <button className="btn btn-outline btn-sm" onClick={() => setViewRx(null)}>{t("close")}</button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{t("newPrescription")}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">{t("patient")} *</Label>
                <PatientSearchSelect
                  testId="select-patient"
                  value={patientId}
                  onChange={setPatientId}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t("prescribingDoctor")} *</Label>
                {/* Prescriber is locked to the signed-in user (the signer) — not a chooser, for any role. */}
                <div className="flex h-9 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3 text-sm text-[var(--ink)]">
                  <ShieldCheck className="w-3.5 h-3.5 text-[var(--teal-600)] flex-shrink-0" />
                  <span className="truncate">{user?.fullName}</span>
                  <span className="text-[var(--ink-muted)] text-xs">({t("you")})</span>
                </div>
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

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>{t("cancel")}</button>
              <button
                className="btn btn-outline btn-sm gap-1.5"
                onClick={() => handleSave("print")}
                disabled={createMutation.isPending || sendToPharmacyMutation.isPending}
                data-testid="button-save-print-prescription"
              >
                <Printer className="w-3.5 h-3.5" /> {t("externalPharmacy")}
              </button>
              <button
                className="btn btn-primary btn-sm gap-1.5"
                onClick={() => handleSave("pharmacy")}
                disabled={createMutation.isPending || sendToPharmacyMutation.isPending}
                data-testid="button-save-send-prescription"
              >
                <Send className="w-3.5 h-3.5" /> {t("inClinicPharmacy")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
