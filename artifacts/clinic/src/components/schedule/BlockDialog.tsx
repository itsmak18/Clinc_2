import { useMemo } from "react";
import { type DoctorScheduleDay, type UpsertWeeklyBlockBody } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { WEEK_DAYS as DAYS, type DayOfWeek } from "@/lib/datetime";
export type { DayOfWeek };

const SLOT_OPTIONS = [10, 15, 20, 30, 45, 60];

export interface BlockFormState {
  dayOfWeek: DayOfWeek | "";
  startTime: string;
  endTime: string;
  slotMinutes: number;
  maxPatients: number;
  notes: string;
}

export const DEFAULT_BLOCK: BlockFormState = {
  dayOfWeek: "",
  startTime: "08:00",
  endTime: "13:00",
  slotMinutes: 30,
  maxPatients: 16,
  notes: "",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** If set, we're editing this day's existing block. If null, adding new. */
  editingDay: DayOfWeek | null;
  form: BlockFormState;
  onFormChange: (patch: Partial<BlockFormState>) => void;
  onSubmit: (doctorId: number, data: UpsertWeeklyBlockBody) => void;
  doctorId: number;
  pending: boolean;
}

export function BlockDialog({ open, onOpenChange, editingDay, form, onFormChange, onSubmit, doctorId, pending }: Props) {
  const { t } = useI18n();

  const previewSlotCount = useMemo(() => {
    if (!form.startTime || !form.endTime) return 0;
    const [sh, sm] = form.startTime.split(":").map(Number);
    const [eh, em] = form.endTime.split(":").map(Number);
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    if (end <= start) return 0;
    return Math.floor((end - start) / form.slotMinutes);
  }, [form.startTime, form.endTime, form.slotMinutes]);

  function handleSubmit() {
    if (!form.dayOfWeek) return;
    onSubmit(doctorId, {
      dayOfWeek: form.dayOfWeek,
      startTime: form.startTime,
      endTime: form.endTime,
      slotMinutes: form.slotMinutes,
      maxPatients: form.maxPatients,
      notes: form.notes || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{editingDay ? t("editBlock") : t("addBlock")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          {!editingDay && (
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("date")}</Label>
              <Select
                value={form.dayOfWeek}
                onValueChange={(v) => onFormChange({ dayOfWeek: v as DayOfWeek })}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {DAYS.map((d) => (
                    <SelectItem key={d} value={d}>{t(d as Parameters<typeof t>[0])}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("startTime")}</Label>
              <Input type="time" value={form.startTime} onChange={(e) => onFormChange({ startTime: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("endTime")}</Label>
              <Input type="time" value={form.endTime} onChange={(e) => onFormChange({ endTime: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("slotDuration")} (min)</Label>
              <Select
                value={String(form.slotMinutes)}
                onValueChange={(v) => onFormChange({ slotMinutes: Number(v) })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
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
                value={form.maxPatients}
                onChange={(e) => onFormChange({ maxPatients: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("notes")}</Label>
            <Textarea rows={2} value={form.notes} onChange={(e) => onFormChange({ notes: e.target.value })} />
          </div>
          {previewSlotCount > 0 && (
            <p className="text-xs text-[var(--ink-muted)]">{previewSlotCount} {t("previewSlots")}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn btn-outline btn-sm" onClick={() => onOpenChange(false)}>{t("cancel")}</button>
          <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={pending}>{t("save")}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function blockFormFromDay(day: DoctorScheduleDay): BlockFormState {
  return {
    dayOfWeek: day.dayOfWeek as DayOfWeek,
    startTime: day.startTime,
    endTime: day.endTime,
    slotMinutes: day.slotMinutes,
    maxPatients: day.maxPatients,
    notes: day.notes ?? "",
  };
}
