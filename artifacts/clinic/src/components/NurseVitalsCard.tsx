import { useListVitals, getListVitalsQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useI18n } from "@/hooks/i18n";
import { formatDateTime } from "@/lib/api";
import VitalChip from "@/components/VitalChip";
import { Activity, HeartPulse } from "lucide-react";

/**
 * Nurse-facing vitals panel on the patient page: shows the most recent reading
 * (or an empty state) and a one-tap "Record Vitals" action. Keeps the nurse's
 * patient view focused on what she acts on — no clinical records / orders.
 */
export default function NurseVitalsCard({ patientId }: { patientId: number }) {
  const { t } = useI18n();
  const [, setLocation] = useLocation();

  const params = { patientId };
  const { data: vitals } = useListVitals(params, { query: { queryKey: getListVitalsQueryKey(params) } });
  const latest = vitals?.[0];
  const v = latest?.vitals ?? {};

  return (
    <div className="card">
      <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
        <HeartPulse className="w-4 h-4 text-[var(--teal-600)]" />
        <span className="font-semibold text-[13px] text-[var(--ink)]">{t("lastVitals")}</span>
        {latest && <span className="text-[10px] text-[var(--ink-faint)] ms-auto">{formatDateTime(latest.createdAt)}</span>}
      </div>
      <div className="card-pad space-y-3">
        {!latest ? (
          <div className="flex flex-col items-center justify-center py-6 text-[var(--ink-faint)] gap-2">
            <Activity className="w-6 h-6 opacity-30" />
            <p className="text-[12px]">{t("vitalsNoneYet")}</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {v.bloodPressureSystolic != null && (
              <VitalChip vitalKey="bp" value={`${v.bloodPressureSystolic}/${v.bloodPressureDiastolic ?? "—"}`} />
            )}
            {v.heartRate != null && <VitalChip vitalKey="hr" value={v.heartRate} />}
            {v.temperature != null && <VitalChip vitalKey="temp" value={v.temperature} />}
            {v.oxygenSaturation != null && <VitalChip vitalKey="spo2" value={v.oxygenSaturation} />}
            {v.respiratoryRate != null && <VitalChip vitalKey="rr" value={v.respiratoryRate} />}
            {v.glucose != null && <VitalChip vitalKey="glucose" value={v.glucose} />}
          </div>
        )}
        <button
          className="btn btn-primary btn-sm gap-1.5 w-full justify-center"
          onClick={() => setLocation("/vitals")}
          data-testid="button-record-vitals"
        >
          <HeartPulse className="w-3.5 h-3.5" /> {t("recordVitals")}
        </button>
      </div>
    </div>
  );
}
