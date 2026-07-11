import { type DoctorScheduleDay, type UpdateWeeklyBlockStatusBody } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { cn } from "@/lib/utils";
import { Clock, Users, CheckCircle2, XCircle, Pencil, Trash2 } from "lucide-react";
import { WEEK_DAYS as DAY_ORDER } from "@/lib/datetime";

interface Props {
  blocks: DoctorScheduleDay[];
  canEdit: boolean;
  doctorId: number;
  onEdit: (block: DoctorScheduleDay) => void;
  onToggleStatus: (doctorId: number, day: string, data: UpdateWeeklyBlockStatusBody) => void;
  onDelete: (doctorId: number, day: string) => void;
}

export function WeeklyTemplateList({ blocks, canEdit, doctorId, onEdit, onToggleStatus, onDelete }: Props) {
  const { t } = useI18n();

  const sorted = [...blocks].sort(
    (a, b) => DAY_ORDER.indexOf(a.dayOfWeek as typeof DAY_ORDER[number]) - DAY_ORDER.indexOf(b.dayOfWeek as typeof DAY_ORDER[number]),
  );

  if (sorted.length === 0) {
    return <p className="p-4 text-sm text-[var(--ink-muted)]">{t("noScheduleSet")}</p>;
  }

  return (
    <div className="p-3 space-y-2">
      {sorted.map((block) => (
        <div
          key={block.id}
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-[var(--line)] px-3 py-2.5",
            block.status === "active" ? "bg-[var(--surface)]" : "bg-[var(--surface-2)] opacity-70",
          )}
        >
          <div className="w-24 flex-shrink-0">
            <div className="font-medium text-[13px] text-[var(--ink)] capitalize">{t(block.dayOfWeek as Parameters<typeof t>[0])}</div>
            <div className="text-[11px] text-[var(--ink-muted)]">
              {block.startTime.slice(0, 5)} – {block.endTime.slice(0, 5)}
            </div>
          </div>
          <span className="badge text-[11px] gap-1"><Clock className="w-3 h-3" /> {block.slotMinutes} min</span>
          <span className="badge text-[11px] gap-1"><Users className="w-3 h-3" /> {block.maxPatients}</span>
          <div className="ms-auto flex items-center gap-1.5">
            {canEdit ? (
              <button
                onClick={() => onToggleStatus(doctorId, block.dayOfWeek, { status: block.status === "active" ? "inactive" : "active" })}
                className="btn btn-ghost btn-sm h-7 w-7 p-0"
                title={block.status === "active" ? t("active") : t("inactive")}
              >
                {block.status === "active" ? (
                  <CheckCircle2 className="w-4 h-4 text-[var(--teal-600)]" />
                ) : (
                  <XCircle className="w-4 h-4 text-[var(--ink-muted)]" />
                )}
              </button>
            ) : (
              <span className={cn("badge text-[11px]", block.status === "active" ? "badge-teal" : "")}>
                {t(block.status as Parameters<typeof t>[0])}
              </span>
            )}
            {canEdit && (
              <>
                <button className="btn btn-ghost btn-sm h-7 w-7 p-0" onClick={() => onEdit(block)}>
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  className="btn btn-ghost btn-sm h-7 w-7 p-0 text-[var(--rose-500)]"
                  onClick={() => onDelete(doctorId, block.dayOfWeek)}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
