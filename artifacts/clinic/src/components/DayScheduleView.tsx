import { useState } from "react";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/hooks/i18n";

const STATUS_COLOR: Record<string, string> = {
  scheduled:           "bg-slate-100 border-slate-300 text-slate-700",
  checked_in:          "bg-yellow-100 border-yellow-300 text-yellow-800",
  in_triage:           "bg-orange-100 border-orange-300 text-orange-800",
  ready_for_doctor:    "bg-blue-100 border-blue-300 text-blue-800",
  in_consultation:     "bg-indigo-100 border-indigo-300 text-indigo-800",
  awaiting_diagnostics:"bg-purple-100 border-purple-300 text-purple-800",
  pending_payment:     "bg-pink-100 border-pink-300 text-pink-800",
  completed:           "bg-green-100 border-green-300 text-green-800",
  cancelled:           "bg-red-100 border-red-300 text-red-800",
  no_show:             "bg-gray-100 border-gray-300 text-gray-600",
};

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7am..8pm

interface Appt {
  id: number;
  scheduledAt: string | Date;
  reason?: string | null;
  status: string;
  patient?: { fullName?: string | null; mrn?: string | null } | null;
  doctor?: { id?: number; fullName?: string | null } | null;
}

interface Props {
  appointments: Appt[];
  selectedDate: string;
}

export default function DayScheduleView({ appointments, selectedDate }: Props) {
  const { t } = useI18n();
  const [doctorFilter, setDoctorFilter] = useState("all");

  const doctors = Array.from(
    new Map(
      appointments
        .filter(a => a.doctor?.id)
        .map(a => [a.doctor!.id, a.doctor!.fullName ?? t("unknown")])
    ).entries()
  );

  const filtered = appointments.filter(a => {
    if (doctorFilter !== "all" && String(a.doctor?.id) !== doctorFilter) return false;
    const d = new Date(a.scheduledAt);
    const dateStr = d.toISOString().split("T")[0];
    return dateStr === selectedDate;
  });

  const byHour: Record<number, Appt[]> = {};
  for (const a of filtered) {
    const h = new Date(a.scheduledAt).getHours();
    if (!byHour[h]) byHour[h] = [];
    byHour[h].push(a);
  }

  const totalToday = filtered.length;
  const completed = filtered.filter(a => a.status === "completed").length;
  const active = filtered.filter(a => !["completed", "cancelled", "no_show"].includes(a.status)).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 flex-wrap">
        {doctors.length > 0 && (
          <div className="flex items-center gap-2">
            <Label className="text-xs">{t("doctorLabel")}</Label>
            <Select value={doctorFilter} onValueChange={setDoctorFilter}>
              <SelectTrigger className="h-7 text-xs w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allDoctors")}</SelectItem>
                {doctors.map(([id, name]) => (
                  <SelectItem key={id} value={String(id)}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="flex gap-3 text-xs text-muted-foreground ms-auto">
          <span className="font-medium text-foreground">{totalToday}</span> {t("scheduledCount")}
          <span>·</span>
          <span className="text-blue-600 font-medium">{active}</span> {t("activeLabel")}
          <span>·</span>
          <span className="text-green-600 font-medium">{completed}</span> {t("completedLabel")}
        </div>
      </div>

      {totalToday === 0 ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-lg">
          {t("noAppointmentsForDayView")}
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden bg-card">
          {HOURS.map(hour => {
            const appts = byHour[hour] ?? [];
            const label = hour === 12 ? "12:00 PM" : hour < 12 ? `${hour}:00 AM` : `${hour - 12}:00 PM`;
            const isNow = new Date().getHours() === hour && selectedDate === new Date().toISOString().split("T")[0];
            return (
              <div
                key={hour}
                className={cn(
                  "flex items-start gap-3 px-3 py-2 border-b border-border/50 last:border-0 min-h-[44px]",
                  isNow && "bg-primary/5"
                )}
              >
                <div className={cn("text-[11px] w-16 flex-shrink-0 pt-1 font-mono", isNow ? "text-primary font-semibold" : "text-muted-foreground")}>
                  {label}
                  {isNow && <div className="w-1.5 h-1.5 rounded-full bg-primary mt-1 animate-pulse" />}
                </div>
                <div className="flex-1 flex flex-wrap gap-1.5 py-0.5">
                  {appts.length === 0 ? (
                    <div className="w-full h-4" />
                  ) : (
                    appts.map(a => (
                      <div
                        key={a.id}
                        className={cn(
                          "flex flex-col px-2.5 py-1.5 rounded border text-xs max-w-[200px] min-w-[140px]",
                          STATUS_COLOR[a.status] ?? "bg-muted border-border text-foreground"
                        )}
                      >
                        <span className="font-semibold truncate">{a.patient?.fullName ?? `#${a.id}`}</span>
                        <span className="text-[10px] opacity-70 truncate">{a.reason ?? "—"}</span>
                        {doctorFilter === "all" && a.doctor?.fullName && (
                          <span className="text-[10px] opacity-60 truncate">{a.doctor.fullName}</span>
                        )}
                        <span className="text-[10px] opacity-70 capitalize mt-0.5">{a.status.replace(/_/g, " ")}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground pt-1">
        {Object.entries(STATUS_COLOR).slice(0, 7).map(([status, cls]) => (
          <span key={status} className="flex items-center gap-1">
            <span className={cn("inline-block w-2.5 h-2.5 rounded-sm border", cls)} />
            {status.replace(/_/g, " ")}
          </span>
        ))}
      </div>
    </div>
  );
}
