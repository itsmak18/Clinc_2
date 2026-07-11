import { type WeekDay } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { addDays } from "@/lib/datetime";

function workloadColor(booked: number, total: number): string {
  if (total === 0) return "bg-[var(--line)]";
  const pct = booked / total;
  if (pct >= 0.9) return "bg-[var(--rose-500)]";
  if (pct >= 0.6) return "bg-[var(--amber-500)]";
  return "bg-[var(--teal-500)]";
}

function workloadWidth(booked: number, total: number): string {
  if (total === 0) return "0%";
  return `${Math.min(100, Math.round((booked / total) * 100))}%`;
}

interface Props {
  weekStart: string;
  days: WeekDay[];
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

export function WeekCalendar({ weekStart, days, onPrev, onNext, onToday }: Props) {
  const { t } = useI18n();

  const monthLabel = new Date(weekStart + "T00:00:00").toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });

  return (
    <section className="card overflow-hidden">
      <div className="card-pad border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between">
        <span className="font-medium text-sm text-[var(--ink)]">{monthLabel}</span>
        <div className="flex items-center gap-1">
          <button className="btn btn-ghost btn-sm h-6 w-6 p-0" onClick={onPrev}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button className="btn btn-ghost btn-sm h-6 text-xs px-2" onClick={onToday}>
            {t("today")}
          </button>
          <button className="btn btn-ghost btn-sm h-6 w-6 p-0" onClick={onNext}>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 divide-x divide-[var(--line)]">
        {days.map((day) => (
          <div key={day.date} className={cn("p-2 text-center text-xs", day.isToday ? "bg-[var(--teal-50)]" : "")}>
            <div className="font-medium capitalize text-[var(--ink-muted)]">
              {t(day.dayName as Parameters<typeof t>[0]).slice(0, 3)}
            </div>
            <div className={cn("text-sm font-semibold mt-0.5", day.isToday ? "text-[var(--teal-600)]" : "text-[var(--ink)]")}>
              {new Date(day.date + "T00:00:00").getDate()}
            </div>
            {day.isWorking ? (
              <>
                <div className="text-[10px] text-[var(--ink-muted)] mt-1">
                  {day.bookedCount}/{day.totalSlots}
                </div>
                <div className="h-1.5 rounded-full bg-[var(--line)] mt-1 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${workloadColor(day.bookedCount, day.totalSlots)}`}
                    style={{ width: workloadWidth(day.bookedCount, day.totalSlots) }}
                  />
                </div>
                {day.overrideReason && (
                  <div className="text-[10px] text-[var(--amber-600)] mt-1 truncate" title={day.overrideReason}>
                    {day.overrideReason}
                  </div>
                )}
              </>
            ) : (
              <div className="text-[10px] text-[var(--ink-muted)] mt-1">
                {day.overrideReason ?? "—"}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Returns the weekStart shifted by `n` weeks (for prev/next buttons). */
export function shiftWeek(weekStart: string, n: number): string {
  return addDays(weekStart, n * 7);
}
