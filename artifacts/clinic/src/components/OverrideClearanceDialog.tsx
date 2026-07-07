import { useState } from "react";
import { useOverrideInvoiceClearance } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ShieldAlert } from "lucide-react";

/**
 * Emergency clearance override (ADR-011): clinical roles unblock a basket's
 * pending orders without payment. Requires a ≥30-char clinical justification;
 * the invoice stays pending (visible debt) and the act is audited
 * (EMERGENCY_CLEARANCE_OVERRIDE) + surfaced on the reconciliation report.
 * Role enforcement lives in the API (super_admin/admin/doctor/nurse).
 */
export default function OverrideClearanceDialog({
  invoiceId,
  onOpenChange,
  onDone,
}: {
  invoiceId: number | null;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const [reason, setReason] = useState("");

  const mutation = useOverrideInvoiceClearance({
    mutation: {
      onSuccess: () => {
        toast({ title: t("overrideSuccess") });
        setReason("");
        onOpenChange(false);
        onDone?.();
      },
      onError: () => toast({ title: t("failed"), variant: "destructive" }),
    },
  });

  return (
    <Dialog open={invoiceId !== null} onOpenChange={o => { if (!o) setReason(""); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[var(--amber-700)]" /> {t("emergencyOverride")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-[var(--ink-muted)]">{t("lockedUntilCleared")}</p>
          <div className="space-y-1">
            <Label className="text-xs">{t("overrideReason")} *</Label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              data-testid="input-override-reason"
            />
            <p className="text-[10px] text-[var(--ink-muted)] text-end">{reason.trim().length}/30</p>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button className="btn btn-outline btn-sm" onClick={() => onOpenChange(false)}>{t("cancel")}</button>
            <button
              className="btn btn-danger btn-sm gap-1.5"
              disabled={reason.trim().length < 30 || mutation.isPending}
              onClick={() => invoiceId !== null && mutation.mutate({ invoiceId, data: { reason: reason.trim() } })}
              data-testid="button-confirm-override"
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              {mutation.isPending ? t("loading") : t("emergencyOverride")}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
