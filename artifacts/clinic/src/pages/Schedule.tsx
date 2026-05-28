import { useState, useMemo } from "react";
import {
  useListScheduleDoctors,
  useGetDoctorSchedule,
  useGetScheduleWeek,
  useUpsertWeeklyBlock,
  useUpdateWeeklyBlockStatus,
  useDeleteWeeklyBlock,
  useUpsertScheduleOverride,
  useDeleteScheduleOverride,
  getListScheduleDoctorsQueryKey,
  getGetDoctorScheduleQueryKey,
  getGetScheduleWeekQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/auth";
import { useI18n } from "@/hooks/i18n";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  Plus, Pencil, Trash2, ChevronLeft, ChevronRight,
  CalendarOff, Clock, Users, CheckCircle2, XCircle,
} from "lucide-react";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
type DayOfWeek = typeof DAYS[number];

const SLOT_OPTIONS = [10, 15, 20, 30, 45, 60];

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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

interface BlockForm {
  dayOfWeek: DayOfWeek | "";
  startTime: string;
  endTime: string;
  slotMinutes: number;
  maxPatients: number;
  notes: string;
}

const defaultBlock: BlockForm = {
  dayOfWeek: "",
  startTime: "08:00",
  endTime: "13:00",
  slotMinutes: 30,
  maxPatients: 16,
  notes: "",
};

interface OverrideForm {
  overrideDate: string;
  isBlocked: boolean;
  startTime: string;
  endTime: string;
  reason: string;
}

const defaultOverride: OverrideForm = {
  overrideDate: "",
  isBlocked: true,
  startTime: "08:00",
  endTime: "13:00",
  reason: "",
};

export default function Schedule() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = user?.role === "super_admin" || user?.role === "admin";
  const isDoctor = user?.role === "doctor";

  const [selectedDoctorId, setSelectedDoctorId] = useState<number | null>(null);
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));

  const [showBlock, setShowBlock] = useState(false);
  const [editingDay, setEditingDay] = useState<DayOfWeek | null>(null);
  const [blockForm, setBlockForm] = useState<BlockForm>(defaultBlock);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(defaultOverride);

  const { data: doctorsList = [], isLoading: loadingDoctors } = useListScheduleDoctors();

  const activeDoctorId = isDoctor ? user?.id ?? null : selectedDoctorId;

  const { data: scheduleDetail, isLoading: loadingDetail } = useGetDoctorSchedule(
    activeDoctorId!,
    { query: { enabled: !!activeDoctorId, queryKey: getGetDoctorScheduleQueryKey(activeDoctorId!) } }
  );

  const { data: weekData } = useGetScheduleWeek(
    { doctorId: activeDoctorId!, weekStart },
    { query: { enabled: !!activeDoctorId, queryKey: getGetScheduleWeekQueryKey({ doctorId: activeDoctorId!, weekStart }) } }
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: getListScheduleDoctorsQueryKey() });
    if (activeDoctorId) {
      qc.invalidateQueries({ queryKey: getGetDoctorScheduleQueryKey(activeDoctorId) });
      qc.invalidateQueries({ queryKey: getGetScheduleWeekQueryKey({ doctorId: activeDoctorId, weekStart }) });
    }
  };

  const upsertBlock = useUpsertWeeklyBlock({
    mutation: {
      onSuccess: () => { invalidate(); setShowBlock(false); toast({ title: t("save") }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const toggleStatus = useUpdateWeeklyBlockStatus({
    mutation: {
      onSuccess: () => { invalidate(); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const deleteBlock = useDeleteWeeklyBlock({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: t("delete") }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const upsertOverride = useUpsertScheduleOverride({
    mutation: {
      onSuccess: () => { invalidate(); setShowOverride(false); toast({ title: t("save") }); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  const deleteOverride = useDeleteScheduleOverride({
    mutation: {
      onSuccess: () => { invalidate(); },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  function openAddBlock() {
    setEditingDay(null);
    setBlockForm(defaultBlock);
    setShowBlock(true);
  }

  function openEditBlock(day: any) {
    setEditingDay(day.dayOfWeek);
    setBlockForm({
      dayOfWeek: day.dayOfWeek,
      startTime: day.startTime,
      endTime: day.endTime,
      slotMinutes: day.slotMinutes,
      maxPatients: day.maxPatients,
      notes: day.notes ?? "",
    });
    setShowBlock(true);
  }

  function submitBlock() {
    if (!activeDoctorId || !blockForm.dayOfWeek) return;
    upsertBlock.mutate({
      doctorId: activeDoctorId,
      data: {
        dayOfWeek: blockForm.dayOfWeek,
        startTime: blockForm.startTime,
        endTime: blockForm.endTime,
        slotMinutes: blockForm.slotMinutes,
        maxPatients: blockForm.maxPatients,
        notes: blockForm.notes || undefined,
      },
    });
  }

  function submitOverride() {
    if (!activeDoctorId || !overrideForm.overrideDate) return;
    upsertOverride.mutate({
      doctorId: activeDoctorId,
      data: {
        overrideDate: overrideForm.overrideDate,
        isBlocked: overrideForm.isBlocked,
        startTime: overrideForm.isBlocked ? undefined : overrideForm.startTime,
        endTime: overrideForm.isBlocked ? undefined : overrideForm.endTime,
        reason: overrideForm.reason || undefined,
      },
    });
  }

  const previewSlotCount = useMemo(() => {
    if (!blockForm.startTime || !blockForm.endTime) return 0;
    const [sh, sm] = blockForm.startTime.split(":").map(Number);
    const [eh, em] = blockForm.endTime.split(":").map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (end <= start) return 0;
    return Math.floor((end - start) / blockForm.slotMinutes);
  }, [blockForm.startTime, blockForm.endTime, blockForm.slotMinutes]);

  const selectedDoctor = isDoctor
    ? (doctorsList as any[])[0]
    : (doctorsList as any[]).find((d: any) => d.id === selectedDoctorId);

  return (
    <div className="page">
      {/* Toolbar */}
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
        {/* Doctor sidebar */}
        {!isDoctor && (
          <div className="card overflow-hidden">
            <div className="card-pad border-b border-[var(--line)] bg-[var(--surface-2)]">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{t("selectDoctor")}</p>
            </div>
            {loadingDoctors ? (
              <p className="p-3 text-sm text-[var(--ink-muted)]">{t("loading")}</p>
            ) : (doctorsList as any[]).length === 0 ? (
              <p className="p-3 text-sm text-[var(--ink-muted)]">{t("noData")}</p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {(doctorsList as any[]).map((doc: any) => (
                  <li key={doc.id}>
                    <button
                      onClick={() => setSelectedDoctorId(doc.id)}
                      className={cn(
                        "w-full text-start px-3 py-2.5 text-sm transition-colors hover:bg-[var(--surface-2)]",
                        selectedDoctorId === doc.id
                          ? "bg-[var(--teal-50)] border-s-2 border-[var(--teal-600)] font-medium"
                          : ""
                      )}
                    >
                      <div className="font-medium leading-tight text-[var(--ink)]">{doc.fullName}</div>
                      {doc.specialty && (
                        <div className="text-xs text-[var(--ink-muted)] mt-0.5">{doc.specialty}</div>
                      )}
                      <div className="mt-1">
                        <span className={cn("badge text-[10px] px-1 py-0", doc.isOnShift ? "badge-teal" : "")}>
                          {doc.isOnShift ? t("onShift") : t("offShift")}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Main content */}
        <div className="flex flex-col gap-4">
          {!activeDoctorId ? (
            <div className="flex items-center justify-center h-full text-[var(--ink-muted)] text-sm">
              {t("selectDoctor")}
            </div>
          ) : loadingDetail ? (
            <p className="text-sm text-[var(--ink-muted)]">{t("loading")}</p>
          ) : (
            <>
              {/* Doctor header */}
              {selectedDoctor && (
                <div className="flex items-center gap-3">
                  <div>
                    <h2 className="font-semibold text-lg text-[var(--ink)]">{selectedDoctor.fullName}</h2>
                    {selectedDoctor.specialty && (
                      <p className="text-sm text-[var(--ink-muted)]">{selectedDoctor.specialty}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Weekly template */}
              <section className="card overflow-hidden">
                <div className="card-pad border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between">
                  <span className="font-medium text-sm text-[var(--ink)]">{t("weeklyTemplate")}</span>
                </div>
                {(scheduleDetail as any)?.weeklyTemplate?.length === 0 ? (
                  <p className="p-4 text-sm text-[var(--ink-muted)]">{t("noScheduleSet")}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-[var(--ink-muted)] border-b border-[var(--line)]">
                        <th className="px-4 py-2 text-start">{t("date")}</th>
                        <th className="px-4 py-2 text-start">{t("status")}</th>
                        <th className="px-4 py-2 text-start">{t("slotDuration")}</th>
                        <th className="px-4 py-2 text-start">{t("maxPatients")}</th>
                        {canEdit && <th className="px-4 py-2 text-start">{t("actions")}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {((scheduleDetail as any)?.weeklyTemplate ?? [])
                        .slice()
                        .sort((a: any, b: any) => DAYS.indexOf(a.dayOfWeek) - DAYS.indexOf(b.dayOfWeek))
                        .map((block: any) => (
                          <tr key={block.id} className="hover:bg-[var(--surface-2)]">
                            <td className="px-4 py-2 capitalize font-medium text-[var(--ink)]">
                              {t(block.dayOfWeek as any)}
                              <span className="text-[var(--ink-muted)] ms-2">
                                {block.startTime.slice(0, 5)} – {block.endTime.slice(0, 5)}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              {canEdit ? (
                                <button
                                  onClick={() =>
                                    toggleStatus.mutate({
                                      doctorId: activeDoctorId,
                                      day: block.dayOfWeek,
                                      data: { status: block.status === "active" ? "inactive" : "active" },
                                    })
                                  }
                                  className="btn btn-ghost btn-sm h-6 w-6 p-0"
                                >
                                  {block.status === "active" ? (
                                    <CheckCircle2 className="w-4 h-4 text-[var(--teal-600)]" />
                                  ) : (
                                    <XCircle className="w-4 h-4 text-[var(--ink-muted)]" />
                                  )}
                                </button>
                              ) : (
                                <span className={cn("badge text-xs", block.status === "active" ? "badge-teal" : "")}>
                                  {t(block.status as any)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-1 text-[var(--ink)]">
                                <Clock className="w-3 h-3 text-[var(--ink-muted)]" />
                                {block.slotMinutes} min
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-1 text-[var(--ink)]">
                                <Users className="w-3 h-3 text-[var(--ink-muted)]" />
                                {block.maxPatients}
                              </span>
                            </td>
                            {canEdit && (
                              <td className="px-4 py-2">
                                <div className="flex gap-1">
                                  <button
                                    className="btn btn-ghost btn-sm h-7 w-7 p-0"
                                    onClick={() => openEditBlock(block)}
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </button>
                                  <button
                                    className="btn btn-ghost btn-sm h-7 w-7 p-0 text-[var(--rose-500)]"
                                    onClick={() => deleteBlock.mutate({ doctorId: activeDoctorId, day: block.dayOfWeek })}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </section>

              {/* Week calendar */}
              <section className="card overflow-hidden">
                <div className="card-pad border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between">
                  <span className="font-medium text-sm text-[var(--ink)]">
                    {new Date(weekStart + "T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                  </span>
                  <div className="flex items-center gap-1">
                    <button className="btn btn-ghost btn-sm h-6 w-6 p-0" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button className="btn btn-ghost btn-sm h-6 text-xs px-2" onClick={() => setWeekStart(getWeekStart(new Date()))}>
                      {t("today")}
                    </button>
                    <button className="btn btn-ghost btn-sm h-6 w-6 p-0" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-7 divide-x divide-[var(--line)]">
                  {((weekData as any)?.days ?? []).map((day: any) => (
                    <div
                      key={day.date}
                      className={cn("p-2 text-center text-xs", day.isToday ? "bg-[var(--teal-50)]" : "")}
                    >
                      <div className="font-medium capitalize text-[var(--ink-muted)]">
                        {t(day.dayName as any).slice(0, 3)}
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

              {/* Overrides */}
              <section className="card overflow-hidden">
                <div className="card-pad border-b border-[var(--line)] bg-[var(--surface-2)] flex items-center justify-between">
                  <span className="font-medium text-sm text-[var(--ink)]">{t("overrides")}</span>
                </div>
                {(scheduleDetail as any)?.overrides?.length === 0 ? (
                  <p className="p-4 text-sm text-[var(--ink-muted)]">{t("noOverrides")}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-[var(--ink-muted)] border-b border-[var(--line)]">
                        <th className="px-4 py-2 text-start">{t("date")}</th>
                        <th className="px-4 py-2 text-start">{t("status")}</th>
                        <th className="px-4 py-2 text-start">{t("notes")}</th>
                        {canEdit && <th className="px-4 py-2 text-start">{t("actions")}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--line)]">
                      {((scheduleDetail as any)?.overrides ?? [])
                        .slice()
                        .sort((a: any, b: any) => a.overrideDate.localeCompare(b.overrideDate))
                        .map((ov: any) => (
                          <tr key={ov.id} className="hover:bg-[var(--surface-2)]">
                            <td className="px-4 py-2 font-mono text-xs text-[var(--ink)]">{ov.overrideDate}</td>
                            <td className="px-4 py-2">
                              {ov.isBlocked ? (
                                <span className="badge badge-rose text-xs">{t("dayOff")}</span>
                              ) : (
                                <span className="badge text-xs">
                                  {ov.startTime?.slice(0, 5)} – {ov.endTime?.slice(0, 5)}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-[var(--ink-muted)]">{ov.reason ?? "—"}</td>
                            {canEdit && (
                              <td className="px-4 py-2">
                                <button
                                  className="btn btn-ghost btn-sm h-7 w-7 p-0 text-[var(--rose-500)]"
                                  onClick={() =>
                                    deleteOverride.mutate({ doctorId: activeDoctorId, date: ov.overrideDate })
                                  }
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </section>
            </>
          )}
        </div>
      </div>

      {/* Add/Edit block dialog */}
      {canEdit && (
        <Dialog open={showBlock} onOpenChange={setShowBlock}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {editingDay ? t("editBlock") : t("addBlock")}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              {!editingDay && (
                <div className="grid gap-1.5">
                  <Label className="text-xs">{t("date")}</Label>
                  <Select
                    value={blockForm.dayOfWeek}
                    onValueChange={(v) => setBlockForm((f) => ({ ...f, dayOfWeek: v as DayOfWeek }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d) => (
                        <SelectItem key={d} value={d}>{t(d as any)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">{t("startTime")}</Label>
                  <Input
                    type="time"
                    value={blockForm.startTime}
                    onChange={(e) => setBlockForm((f) => ({ ...f, startTime: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">{t("endTime")}</Label>
                  <Input
                    type="time"
                    value={blockForm.endTime}
                    onChange={(e) => setBlockForm((f) => ({ ...f, endTime: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">{t("slotDuration")} (min)</Label>
                  <Select
                    value={String(blockForm.slotMinutes)}
                    onValueChange={(v) => setBlockForm((f) => ({ ...f, slotMinutes: Number(v) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SLOT_OPTIONS.map((n) => (
                        <SelectItem key={n} value={String(n)}>{n} min</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">{t("maxPatients")}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={blockForm.maxPatients}
                    onChange={(e) => setBlockForm((f) => ({ ...f, maxPatients: Number(e.target.value) }))}
                  />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("notes")}</Label>
                <Textarea
                  rows={2}
                  value={blockForm.notes}
                  onChange={(e) => setBlockForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
              {previewSlotCount > 0 && (
                <p className="text-xs text-[var(--ink-muted)]">
                  {previewSlotCount} {t("previewSlots")}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowBlock(false)}>{t("cancel")}</button>
              <button className="btn btn-primary btn-sm" onClick={submitBlock} disabled={upsertBlock.isPending}>
                {t("save")}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Add override dialog */}
      {canEdit && (
        <Dialog open={showOverride} onOpenChange={setShowOverride}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("addOverride")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("date")}</Label>
                <Input
                  type="date"
                  value={overrideForm.overrideDate}
                  onChange={(e) => setOverrideForm((f) => ({ ...f, overrideDate: e.target.value }))}
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch
                  checked={overrideForm.isBlocked}
                  onCheckedChange={(v) => setOverrideForm((f) => ({ ...f, isBlocked: v }))}
                />
                <Label className="text-sm">{t("blockEntireDay")}</Label>
              </div>
              {!overrideForm.isBlocked && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label className="text-xs">{t("startTime")}</Label>
                    <Input
                      type="time"
                      value={overrideForm.startTime}
                      onChange={(e) => setOverrideForm((f) => ({ ...f, startTime: e.target.value }))}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label className="text-xs">{t("endTime")}</Label>
                    <Input
                      type="time"
                      value={overrideForm.endTime}
                      onChange={(e) => setOverrideForm((f) => ({ ...f, endTime: e.target.value }))}
                    />
                  </div>
                </div>
              )}
              <div className="grid gap-1.5">
                <Label className="text-xs">{t("notes")}</Label>
                <Textarea
                  rows={2}
                  value={overrideForm.reason}
                  onChange={(e) => setOverrideForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn btn-outline btn-sm" onClick={() => setShowOverride(false)}>{t("cancel")}</button>
              <button className="btn btn-primary btn-sm" onClick={submitOverride} disabled={upsertOverride.isPending}>
                {t("save")}
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
