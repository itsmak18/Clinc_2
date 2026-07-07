import { type UpsertOverrideBody } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

export interface OverrideFormState {
  overrideDate: string;
  isBlocked: boolean;
  startTime: string;
  endTime: string;
  reason: string;
}

export const DEFAULT_OVERRIDE: OverrideFormState = {
  overrideDate: "",
  isBlocked: true,
  startTime: "08:00",
  endTime: "13:00",
  reason: "",
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  form: OverrideFormState;
  onFormChange: (patch: Partial<OverrideFormState>) => void;
  onSubmit: (doctorId: number, data: UpsertOverrideBody) => void;
  doctorId: number;
  pending: boolean;
}

export function OverrideDialog({ open, onOpenChange, form, onFormChange, onSubmit, doctorId, pending }: Props) {
  const { t } = useI18n();

  function handleSubmit() {
    if (!form.overrideDate) return;
    onSubmit(doctorId, {
      overrideDate: form.overrideDate,
      isBlocked: form.isBlocked,
      startTime: form.isBlocked ? undefined : form.startTime,
      endTime: form.isBlocked ? undefined : form.endTime,
      reason: form.reason || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("addOverride")}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("date")}</Label>
            <Input
              type="date"
              value={form.overrideDate}
              onChange={(e) => onFormChange({ overrideDate: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={form.isBlocked}
              onCheckedChange={(v) => onFormChange({ isBlocked: v })}
            />
            <Label className="text-sm">{t("blockEntireDay")}</Label>
          </div>
          {!form.isBlocked && (
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
          )}
          <div className="grid gap-1.5">
            <Label className="text-xs">{t("notes")}</Label>
            <Textarea rows={2} value={form.reason} onChange={(e) => onFormChange({ reason: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn btn-outline btn-sm" onClick={() => onOpenChange(false)}>{t("cancel")}</button>
          <button className="btn btn-primary btn-sm" onClick={handleSubmit} disabled={pending}>{t("save")}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
