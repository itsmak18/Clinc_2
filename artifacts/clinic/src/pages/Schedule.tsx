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
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Pencil, Trash2, ChevronLeft, ChevronRight,
  CalendarOff, Clock, Users, CheckCircle2, XCircle,
} from "lucide-react";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
type DayOfWeek = typeof DAYS[number];

const SLOT_OPTIONS = [10, 15, 20, 30, 45, 60];

function getWeekStart(date: Date): string {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  d.setDate(d.getDate() - day); // go to Sunday of this week
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function workloadColor(booked: number, total: number): string {
  if (total === 0) return "bg-muted";
  const pct = booked / total;
  if (pct >= 0.9) return "bg-destructive";
  if (pct >= 0.6) return "bg-amber-500";
  return "bg-green-500";
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

  // Dialogs
  const [showBlock, setShowBlock] = useState(false);
  const [editingDay, setEditingDay] = useState<DayOfWeek | null>(null); // null = adding new
  const [blockForm, setBlockForm] = useState<BlockForm>(defaultBlock);
  const [showOverride, setShowOverride] = useState(false);
  const [overrideForm, setOverrideForm] = useState<OverrideForm>(defaultOverride);

  // ── Queries ──────────────────────────────────────────
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

  // ── Mutations ────────────────────────────────────────
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
      onError: () => toast({ title: "Error", variant: "destructive" }),
    },
  });

  const toggleStatus = useUpdateWeeklyBlockStatus({
    mutation: {
      onSuccess: () => { invalidate(); },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    },
  });

  const deleteBlock = useDeleteWeeklyBlock({
    mutation: {
      onSuccess: () => { invalidate(); toast({ title: t("delete") }); },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    },
  });

  const upsertOverride = useUpsertScheduleOverride({
    mutation: {
      onSuccess: () => { invalidate(); setShowOverride(false); toast({ title: t("save") }); },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    },
  });

  const deleteOverride = useDeleteScheduleOverride({
    mutation: {
      onSuccess: () => { invalidate(); },
      onError: () => toast({ title: "Error", variant: "destructive" }),
    },
  });

  // ── Handlers ─────────────────────────────────────────
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

  // ── Render ────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 p-4">
      <PageHeader
        title={t("schedule")}
        actions={
          canEdit && activeDoctorId ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowOverride(true)}>
                <CalendarOff className="w-4 h-4 mr-1" /> {t("addOverride")}
              </Button>
              <Button size="sm" onClick={openAddBlock}>
                <Plus className="w-4 h-4 mr-1" /> {t("addBlock")}
              </Button>
            </div>
          ) : null
        }
      />

      <div className="grid grid-cols-[220px_1fr] gap-4 min-h-[600px]">
        {/* ── Doctor sidebar ── */}
        {!isDoctor && (
          <div className="border rounded-lg overflow-hidden">
            <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground bg-muted/50 border-b">
              {t("selectDoctor")}
            </div>
            {loadingDoctors ? (
              <p className="p-3 text-sm text-muted-foreground">{t("loading")}</p>
            ) : (doctorsList as any[]).length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">{t("noData")}</p>
            ) : (
              <ul className="divide-y">
                {(doctorsList as any[]).map((doc: any) => (
                  <li key={doc.id}>
                    <button
                      onClick={() => setSelectedDoctorId(doc.id)}
                      className={`w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-accent ${
                        selectedDoctorId === doc.id
                          ? "bg-primary/10 border-s-2 border-primary font-medium"
                          : ""
                      }`}
                    >
                      <div className="font-medium leading-tight">{doc.fullName}</div>
                      {doc.specialty && (
                        <div className="text-xs text-muted-foreground mt-0.5">{doc.specialty}</div>
                      )}
                      <div className="mt-1">
                        <Badge variant={doc.isOnShift ? "default" : "secondary"} className="text-[10px] px-1 py-0">
                          {doc.isOnShift ? t("onShift") : t("offShift")}
                        </Badge>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* ── Main content ── */}
        <div className="flex flex-col gap-4">
          {!activeDoctorId ? (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              {t("selectDoctor")}
            </div>
          ) : loadingDetail ? (
            <p className="text-sm text-muted-foreground">{t("loading")}</p>
          ) : (
            <>
              {/* Doctor header */}
              {selectedDoctor && (
                <div className="flex items-center gap-3">
                  <div>
                    <h2 className="font-semibold text-lg">{selectedDoctor.fullName}</h2>
                    {selectedDoctor.specialty && (
                      <p className="text-sm text-muted-foreground">{selectedDoctor.specialty}</p>
                    )}
                  </div>
                </div>
              )}

              {/* ── Weekly template ── */}
              <section className="border rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-muted/50 border-b flex items-center justify-between">
                  <span className="font-medium text-sm">{t("weeklyTemplate")}</span>
                </div>
                {(scheduleDetail as any)?.weeklyTemplate?.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">{t("noScheduleSet")}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b">
                        <th className="px-4 py-2 text-start">{t("date")}</th>
                        <th className="px-4 py-2 text-start">{t("status")}</th>
                        <th className="px-4 py-2 text-start">{t("slotDuration")}</th>
                        <th className="px-4 py-2 text-start">{t("maxPatients")}</th>
                        {canEdit && <th className="px-4 py-2 text-start">{t("actions")}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {((scheduleDetail as any)?.weeklyTemplate ?? [])
                        .slice()
                        .sort((a: any, b: any) => DAYS.indexOf(a.dayOfWeek) - DAYS.indexOf(b.dayOfWeek))
                        .map((block: any) => (
                          <tr key={block.id} className="hover:bg-muted/30">
                            <td className="px-4 py-2 capitalize font-medium">
                              {t(block.dayOfWeek as any)}
                              <span className="text-muted-foreground ml-2">
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
                                  title={block.status}
                                >
                                  {block.status === "active" ? (
                                    <CheckCircle2 className="w-4 h-4 text-green-600" />
                                  ) : (
                                    <XCircle className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </button>
                              ) : (
                                <Badge variant={block.status === "active" ? "default" : "secondary"}>
                                  {t(block.status as any)}
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-muted-foreground" />
                                {block.slotMinutes} min
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <span className="flex items-center gap-1">
                                <Users className="w-3 h-3 text-muted-foreground" />
                                {block.maxPatients}
                              </span>
                            </td>
                            {canEdit && (
                              <td className="px-4 py-2">
                                <div className="flex gap-1">
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7"
                                    onClick={() => openEditBlock(block)}
                                  >
                                    <Pencil className="w-3 h-3" />
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-7 w-7 text-destructive hover:text-destructive"
                                    onClick={() => deleteBlock.mutate({ doctorId: activeDoctorId, day: block.dayOfWeek })}
                                  >
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                </div>
                              </td>
                            )}
                          </tr>
                        ))}
                    </tbody>
                  </table>
                )}
              </section>

              {/* ── Week calendar ── */}
              <section className="border rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-muted/50 border-b flex items-center justify-between">
                  <span className="font-medium text-sm">
                    {new Date(weekStart + "T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                      <ChevronLeft className="w-4 h-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => setWeekStart(getWeekStart(new Date()))}>
                      {t("date")}
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                      <ChevronRight className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                <div className="grid grid-cols-7 divide-x">
                  {((weekData as any)?.days ?? []).map((day: any) => (
                    <div
                      key={day.date}
                      className={`p-2 text-center text-xs ${day.isToday ? "bg-primary/5" : ""}`}
                    >
                      <div className="font-medium capitalize text-muted-foreground">
                        {t(day.dayName as any).slice(0, 3)}
                      </div>
                      <div className={`text-sm font-semibold mt-0.5 ${day.isToday ? "text-primary" : ""}`}>
                        {new Date(day.date + "T00:00:00").getDate()}
                      </div>
                      {day.isWorking ? (
                        <>
                          <div className="text-[10px] text-muted-foreground mt-1">
                            {day.bookedCount}/{day.totalSlots}
                          </div>
                          <div className="h-1.5 rounded-full bg-muted mt-1 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${workloadColor(day.bookedCount, day.totalSlots)}`}
                              style={{ width: workloadWidth(day.bookedCount, day.totalSlots) }}
                            />
                          </div>
                          {day.overrideReason && (
                            <div className="text-[10px] text-amber-600 mt-1 truncate" title={day.overrideReason}>
                              {day.overrideReason}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {day.overrideReason ?? "—"}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* ── Overrides ── */}
              <section className="border rounded-lg overflow-hidden">
                <div className="px-4 py-2 bg-muted/50 border-b flex items-center justify-between">
                  <span className="font-medium text-sm">{t("overrides")}</span>
                </div>
                {(scheduleDetail as any)?.overrides?.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">{t("noOverrides")}</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground border-b">
                        <th className="px-4 py-2 text-start">{t("date")}</th>
                        <th className="px-4 py-2 text-start">{t("status")}</th>
                        <th className="px-4 py-2 text-start">{t("notes")}</th>
                        {canEdit && <th className="px-4 py-2 text-start">{t("actions")}</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {((scheduleDetail as any)?.overrides ?? [])
                        .slice()
                        .sort((a: any, b: any) => a.overrideDate.localeCompare(b.overrideDate))
                        .map((ov: any) => (
                          <tr key={ov.id} className="hover:bg-muted/30">
                            <td className="px-4 py-2 font-mono text-xs">{ov.overrideDate}</td>
                            <td className="px-4 py-2">
                              {ov.isBlocked ? (
                                <Badge variant="destructive">{t("dayOff")}</Badge>
                              ) : (
                                <Badge variant="outline">
                                  {ov.startTime?.slice(0, 5)} – {ov.endTime?.slice(0, 5)}
                                </Badge>
                              )}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">{ov.reason ?? "—"}</td>
                            {canEdit && (
                              <td className="px-4 py-2">
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() =>
                                    deleteOverride.mutate({ doctorId: activeDoctorId, date: ov.overrideDate })
                                  }
                                >
                                  <Trash2 className="w-3 h-3" />
                                </Button>
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

      {/* ── Add/Edit block dialog ── */}
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
                  <Label>{t("date")}</Label>
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
                  <Label>{t("date")} (Start)</Label>
                  <Input
                    type="time"
                    value={blockForm.startTime}
                    onChange={(e) => setBlockForm((f) => ({ ...f, startTime: e.target.value }))}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>{t("date")} (End)</Label>
                  <Input
                    type="time"
                    value={blockForm.endTime}
                    onChange={(e) => setBlockForm((f) => ({ ...f, endTime: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>{t("slotDuration")} (min)</Label>
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
                  <Label>{t("maxPatients")}</Label>
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
                <Label>{t("notes")}</Label>
                <Textarea
                  rows={2}
                  value={blockForm.notes}
                  onChange={(e) => setBlockForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
              {previewSlotCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {previewSlotCount} {t("previewSlots")}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowBlock(false)}>{t("cancel")}</Button>
              <Button onClick={submitBlock} disabled={upsertBlock.isPending}>
                {t("save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Add override dialog ── */}
      {canEdit && (
        <Dialog open={showOverride} onOpenChange={setShowOverride}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("addOverride")}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label>{t("date")}</Label>
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
                <Label>{t("blockEntireDay")}</Label>
              </div>
              {!overrideForm.isBlocked && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-1.5">
                    <Label>{t("date")} (Start)</Label>
                    <Input
                      type="time"
                      value={overrideForm.startTime}
                      onChange={(e) => setOverrideForm((f) => ({ ...f, startTime: e.target.value }))}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>{t("date")} (End)</Label>
                    <Input
                      type="time"
                      value={overrideForm.endTime}
                      onChange={(e) => setOverrideForm((f) => ({ ...f, endTime: e.target.value }))}
                    />
                  </div>
                </div>
              )}
              <div className="grid gap-1.5">
                <Label>{t("notes")}</Label>
                <Textarea
                  rows={2}
                  value={overrideForm.reason}
                  onChange={(e) => setOverrideForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowOverride(false)}>{t("cancel")}</Button>
              <Button onClick={submitOverride} disabled={upsertOverride.isPending}>
                {t("save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
