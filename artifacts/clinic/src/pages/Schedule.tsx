import { useState } from "react";
import { useI18n } from "@/hooks/i18n";
import { useDoctorSchedule } from "@/hooks/useDoctorSchedule";
import { cn } from "@/lib/utils";
import { Plus, CalendarOff, CalendarDays, CalendarRange } from "lucide-react";
import { DoctorAvatar } from "@/components/DoctorAvatar";
import ScheduleDayView from "@/components/ScheduleDayView";
import { DoctorSidebar } from "@/components/schedule/DoctorSidebar";
import { WeeklyTemplateList } from "@/components/schedule/WeeklyTemplateList";
import { WeekCalendar, shiftWeek } from "@/components/schedule/WeekCalendar";
import { OverridesTable } from "@/components/schedule/OverridesTable";
import { BlockDialog, DEFAULT_BLOCK, blockFormFromDay, type BlockFormState, type DayOfWeek } from "@/components/schedule/BlockDialog";
import { OverrideDialog, DEFAULT_OVERRIDE, type OverrideFormState } from "@/components/schedule/OverrideDialog";
import { getWeekStart } from "@/lib/datetime";
import { type DoctorScheduleDay } from "@workspace/api-client-react";

// ─── WeeklyTemplate ──────────────────────────────────────────────────────────

function WeeklyTemplate() {
  const { t } = useI18n();
  const schedule = useDoctorSchedule();

  const [showBlock, setShowBlock] = useState(false);
  const [editingDay, setEditingDay] = useState<DayOfWeek | null>(null);
  const [blockForm, setBlockForm] = useState<BlockFormState>(DEFAULT_BLOCK);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideForm, setOverrideForm] = useState<OverrideFormState>(DEFAULT_OVERRIDE);

  const {
    doctors, loadingDoctors,
    scheduleDetail, loadingDetail,
    weekData,
    activeDoctorId, selectedDoctorId, setSelectedDoctorId,
    weekStart, setWeekStart,
    canEdit, isDoctor,
    upsertBlock, upsertBlockPending,
    toggleBlockStatus, deleteBlock,
    upsertOverride, upsertOverridePending, deleteOverride,
  } = schedule;

  const selectedDoctor = isDoctor
    ? doctors[0]
    : doctors.find((d) => d.id === selectedDoctorId);

  function openAddBlock() {
    setEditingDay(null);
    setBlockForm(DEFAULT_BLOCK);
    setShowBlock(true);
  }

  function openEditBlock(block: DoctorScheduleDay) {
    setEditingDay(block.dayOfWeek as DayOfWeek);
    setBlockForm(blockFormFromDay(block));
    setShowBlock(true);
  }

  // Close only on success — a failed save keeps the dialog (and the user's
  // input) open for correction; the hook's onError toast reports the failure.
  async function handleBlockSubmit(doctorId: number, data: Parameters<typeof upsertBlock>[1]) {
    try {
      await upsertBlock(doctorId, data);
      setShowBlock(false);
    } catch {
      /* dialog stays open */
    }
  }

  async function handleOverrideSubmit(doctorId: number, data: Parameters<typeof upsertOverride>[1]) {
    try {
      await upsertOverride(doctorId, data);
      setShowOverride(false);
    } catch {
      /* dialog stays open */
    }
  }

  return (
    <div>
      {canEdit && activeDoctorId && (
        <div className="flex gap-2 mb-4 justify-end">
          <button className="btn btn-outline btn-sm gap-1.5" onClick={() => setShowOverride(true)}>
            <CalendarOff className="w-3.5 h-3.5" /> {t("addOverride")}
          </button>
          <button className="btn btn-primary btn-sm gap-1.5" onClick={openAddBlock}>
            <Plus className="w-3.5 h-3.5" /> {t("addBlock")}
          </button>
        </div>
      )}

      <div className={cn("grid gap-4 min-h-[600px]", !isDoctor ? "grid-cols-[220px_1fr]" : "grid-cols-1")}>
        {!isDoctor && (
          <DoctorSidebar
            doctors={doctors}
            loading={loadingDoctors}
            selectedId={selectedDoctorId}
            onSelect={setSelectedDoctorId}
          />
        )}

        <div className="flex flex-col gap-4">
          {!activeDoctorId ? (
            <div className="flex items-center justify-center h-full text-[var(--ink-muted)] text-sm">
              {t("selectDoctor")}
            </div>
          ) : loadingDetail ? (
            <p className="text-sm text-[var(--ink-muted)]">{t("loading")}</p>
          ) : (
            <>
              {selectedDoctor && (
                <div className="flex items-center gap-3">
                  <DoctorAvatar id={selectedDoctor.id} name={selectedDoctor.fullName} size={44} />
                  <div>
                    <h2 className="font-semibold text-lg text-[var(--ink)]">{selectedDoctor.fullName}</h2>
                    {selectedDoctor.specialty && (
                      <p className="text-sm text-[var(--ink-muted)]">{selectedDoctor.specialty}</p>
                    )}
                  </div>
                </div>
              )}

              <section className="card overflow-hidden">
                <div className="card-pad border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between">
                  <span className="font-medium text-sm text-[var(--ink)]">{t("weeklyTemplate")}</span>
                </div>
                <WeeklyTemplateList
                  blocks={scheduleDetail?.weeklyTemplate ?? []}
                  canEdit={canEdit}
                  doctorId={activeDoctorId}
                  onEdit={openEditBlock}
                  onToggleStatus={toggleBlockStatus}
                  onDelete={deleteBlock}
                />
              </section>

              <WeekCalendar
                weekStart={weekStart}
                days={weekData?.days ?? []}
                onPrev={() => setWeekStart(shiftWeek(weekStart, -1))}
                onNext={() => setWeekStart(shiftWeek(weekStart, 1))}
                onToday={() => setWeekStart(getWeekStart(new Date()))}
              />

              <section className="card overflow-hidden">
                <div className="card-pad border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between">
                  <span className="font-medium text-sm text-[var(--ink)]">{t("overrides")}</span>
                </div>
                <OverridesTable
                  overrides={scheduleDetail?.overrides ?? []}
                  canEdit={canEdit}
                  doctorId={activeDoctorId}
                  onDelete={deleteOverride}
                />
              </section>
            </>
          )}
        </div>
      </div>

      {canEdit && activeDoctorId && (
        <>
          <BlockDialog
            open={showBlock}
            onOpenChange={setShowBlock}
            editingDay={editingDay}
            form={blockForm}
            onFormChange={(patch) => setBlockForm((f) => ({ ...f, ...patch }))}
            onSubmit={handleBlockSubmit}
            doctorId={activeDoctorId}
            pending={upsertBlockPending}
          />
          <OverrideDialog
            open={showOverride}
            onOpenChange={setShowOverride}
            form={overrideForm}
            onFormChange={(patch) => setOverrideForm((f) => ({ ...f, ...patch }))}
            onSubmit={handleOverrideSubmit}
            doctorId={activeDoctorId}
            pending={upsertOverridePending}
          />
        </>
      )}
    </div>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

export default function Schedule() {
  const { t } = useI18n();
  const [view, setView] = useState<"day" | "template">("day");

  return (
    <div className="page">
      <div className="flex border border-[var(--line)] rounded-lg overflow-hidden w-fit mb-4">
        <button
          className={cn(
            "h-8 px-3 text-xs flex items-center gap-1.5 transition-colors",
            view === "day" ? "bg-[var(--teal-600)] text-white" : "hover:bg-[var(--surface-2)] text-[var(--ink-muted)]",
          )}
          onClick={() => setView("day")}
          data-testid="schedule-tab-day"
        >
          <CalendarDays className="w-3.5 h-3.5" /> {t("dayView")}
        </button>
        <button
          className={cn(
            "h-8 px-3 text-xs flex items-center gap-1.5 border-s border-[var(--line)] transition-colors",
            view === "template" ? "bg-[var(--teal-600)] text-white" : "hover:bg-[var(--surface-2)] text-[var(--ink-muted)]",
          )}
          onClick={() => setView("template")}
          data-testid="schedule-tab-template"
        >
          <CalendarRange className="w-3.5 h-3.5" /> {t("weeklyTemplate")}
        </button>
      </div>
      {view === "day" ? <ScheduleDayView /> : <WeeklyTemplate />}
    </div>
  );
}
