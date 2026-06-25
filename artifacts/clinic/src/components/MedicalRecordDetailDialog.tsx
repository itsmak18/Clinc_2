/**
 * MedicalRecordDetailDialog — read-only "view all information" popup for one
 * medical record. Shared by the Medical Records list page and the Patient detail
 * Overview card so the vitals-flagging + layout live in one place (mirrors
 * DiagnosticResultDialog). The list/summary endpoints already return every field
 * (vitals, treatment, notes, Arabic), so no extra fetch is needed.
 */
import { useI18n } from "@/hooks/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DetailSection, DetailGrid, DetailField } from "@/components/DetailView";
import { formatDate } from "@/lib/api";

// Clinical "normal" ranges — values outside flag amber/rose (informational, not blocking).
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

// Vitals shown in clinical order. `unit` is appended to the value ("" when the i18n
// label already carries its unit); `normalKey` maps to VITAL_NORMAL for flagging.
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

export default function MedicalRecordDetailDialog({ record, onClose }: {
  record: any | null;
  onClose: () => void;
}) {
  const { t } = useI18n();

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

  return (
    <Dialog open={!!record} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t("medicalRecordDetails")}</DialogTitle></DialogHeader>
        {record && (
          <div className="space-y-5">
            <DetailGrid cols={3}>
              <DetailField label={t("patient")} value={record.patient?.fullName || `#${record.patientId}`} />
              <DetailField label={t("doctorLabel")} value={record.doctor?.fullName || `#${record.doctorId}`} />
              <DetailField label={t("date")} value={formatDate(record.createdAt)} />
            </DetailGrid>

            <DetailSection>
              <DetailGrid cols={1}>
                <DetailField label={t("chiefComplaint")} value={record.chiefComplaint} secondary={record.chiefComplaintAr} />
                <DetailField label={t("diagnosis")} value={record.diagnosis} secondary={record.diagnosisAr} />
                <DetailField label={t("treatment")} value={record.treatment} secondary={record.treatmentAr} />
                <DetailField label={t("notes")} value={record.notes} />
              </DetailGrid>
            </DetailSection>

            <DetailSection title={t("vitals")}>
              {renderVitals(record.vitals)}
            </DetailSection>

            <div className="flex justify-end pt-1">
              <button className="btn btn-outline btn-sm" onClick={onClose}>{t("close")}</button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
