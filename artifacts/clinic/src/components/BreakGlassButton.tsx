import { useState } from "react";
import { useActivateBreakGlass } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ShieldAlert } from "lucide-react";

const ACTIVATE_ROLES = ["super_admin", "admin", "doctor", "nurse"];
const MIN_JUSTIFICATION = 30;
const REASONS = [
  { value: "life_threatening_emergency", label: "reasonLifeThreatening" },
  { value: "patient_unconscious", label: "reasonUnconscious" },
  { value: "code_blue_response", label: "reasonCodeBlue" },
  { value: "covering_attending_unavailable", label: "reasonCovering" },
  { value: "regulatory_audit_request", label: "reasonRegulatory" },
] as const;

/**
 * Emergency break-glass activation. Renders only for clinical roles eligible to
 * activate (super_admin/admin/doctor/nurse) — matches the backend route guard.
 */
export default function BreakGlassButton({ patientId }: { patientId: number }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [reasonCategory, setReasonCategory] = useState<string>(REASONS[0].value);
  const [justification, setJustification] = useState("");

  const activate = useActivateBreakGlass({
    mutation: {
      onSuccess: () => {
        toast({ title: t("breakGlassActivated") });
        setOpen(false);
        setJustification("");
      },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  if (!ACTIVATE_ROLES.includes(user?.role ?? "")) return null;

  const tooShort = justification.trim().length < MIN_JUSTIFICATION;

  return (
    <>
      <button className="btn btn-danger btn-sm gap-1.5" onClick={() => setOpen(true)}>
        <ShieldAlert className="w-3.5 h-3.5" /> {t("emergencyAccess")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[var(--rose-500)]">
              <ShieldAlert className="w-4 h-4" /> {t("breakGlassActivateBtn")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="text-xs text-[var(--rose-500)] bg-[var(--rose-50)] border border-[var(--rose-100)] rounded-md p-2.5">
              {t("breakGlassWarning")}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("reasonCategory")}</Label>
              <Select value={reasonCategory} onValueChange={setReasonCategory}>
                <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REASONS.map(r => <SelectItem key={r.value} value={r.value}>{t(r.label as any)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t("justificationLabel")}</Label>
              <Textarea
                rows={3}
                value={justification}
                onChange={e => setJustification(e.target.value)}
                className="text-sm"
              />
              <span className={`text-[11px] ${tooShort ? "text-[var(--rose-500)]" : "text-[var(--ink-muted)]"}`}>
                {justification.trim().length}/{MIN_JUSTIFICATION}
              </span>
            </div>
            <div className="flex justify-end gap-2">
              <button className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>{t("cancel")}</button>
              <button
                className="btn btn-danger btn-sm"
                disabled={tooShort || activate.isPending}
                data-pending={activate.isPending ? "true" : undefined}
                onClick={() => activate.mutate({ patientId, data: { justification: justification.trim(), reasonCategory: reasonCategory as any } })}
              >
                {activate.isPending ? t("loading") : t("breakGlassActivateBtn")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
