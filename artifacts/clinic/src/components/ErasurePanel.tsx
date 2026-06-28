import { useState } from "react";
import {
  useListErasureRequests, getListErasureRequestsQueryKey,
  useCreateErasureRequest, useReviewErasureRequest, useExecuteErasure,
  type ErasureRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Trash2, Plus } from "lucide-react";

const VIEW_ROLES = ["super_admin", "admin", "compliance_officer"];
const REVIEW_ROLES = ["super_admin", "compliance_officer"];
const EXECUTE_ROLES = ["super_admin"];

const STATUS_TONE: Record<string, string> = {
  pending: "badge-amber",
  approved: "badge-blue",
  rejected: "badge-sand",
  executed: "badge-rose",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "erStatusPending",
  approved: "erStatusApproved",
  rejected: "erStatusRejected",
  executed: "erStatusExecuted",
};

export default function ErasurePanel() {
  const { t } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const role = user?.role ?? "";

  const canView = VIEW_ROLES.includes(role);
  const canReview = REVIEW_ROLES.includes(role);
  const canExecute = EXECUTE_ROLES.includes(role);

  const [showForm, setShowForm] = useState(false);
  const [patientId, setPatientId] = useState("");
  const [reason, setReason] = useState("");
  const [executeTarget, setExecuteTarget] = useState<ErasureRequest | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const listKey = getListErasureRequestsQueryKey();
  const { data: requestsResp } = useListErasureRequests(undefined, {
    query: { enabled: canView, queryKey: listKey },
  });
  const requests = requestsResp?.data ?? [];
  const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey });
  const onErr = () => toast({ title: t("failed"), variant: "destructive" });

  const create = useCreateErasureRequest({
    mutation: { onSuccess: () => { toast({ title: t("erasureCreated") }); setShowForm(false); setPatientId(""); setReason(""); invalidate(); }, onError: onErr },
  });
  const review = useReviewErasureRequest({
    mutation: { onSuccess: () => { toast({ title: t("erasureReviewed") }); invalidate(); }, onError: onErr },
  });
  const execute = useExecuteErasure({
    mutation: { onSuccess: () => { toast({ title: t("erasureExecuted") }); setExecuteTarget(null); setConfirmText(""); invalidate(); }, onError: onErr },
  });

  if (!canView) return null;

  const reasonTooShort = reason.trim().length < 10;
  const pidValid = /^\d+$/.test(patientId.trim());

  return (
    <div className="card card-pad mt-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trash2 className="w-4 h-4 text-[var(--rose-500)]" />
          <span className="font-semibold text-[var(--ink)] text-[14px]">{t("erasureRequests")}</span>
        </div>
        <button className="btn btn-outline btn-sm gap-1.5" onClick={() => setShowForm(s => !s)}>
          <Plus className="w-3.5 h-3.5" /> {t("requestErasure")}
        </button>
      </div>

      {showForm && (
        <div className="border border-[var(--line)] rounded-md p-3 mb-3 flex flex-col gap-2.5 bg-[var(--surface-2)]">
          <div className="space-y-1">
            <Label className="text-xs">{t("erasurePatientId")}</Label>
            <Input className="h-8 text-sm w-40" inputMode="numeric" value={patientId} onChange={e => setPatientId(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("erasureReason")}</Label>
            <Textarea rows={2} className="text-sm" value={reason} onChange={e => setReason(e.target.value)} />
          </div>
          <div className="flex justify-end">
            <button
              className="btn btn-primary btn-sm"
              disabled={create.isPending || reasonTooShort || !pidValid}
              onClick={() => create.mutate({ data: { patientId: parseInt(patientId, 10), reason: reason.trim() } })}
            >
              {create.isPending ? t("loading") : t("erasureCreate")}
            </button>
          </div>
        </div>
      )}

      {!requests || requests.length === 0 ? (
        <p className="text-[13px] text-[var(--ink-muted)] text-center py-6">{t("noErasureRequests")}</p>
      ) : (
        <div className="space-y-1.5">
          {requests.map((r: ErasureRequest) => (
            <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-[var(--line)] text-[13px]">
              <span className={cn("badge text-[10px] flex-shrink-0", STATUS_TONE[r.status] ?? "")}>{t(STATUS_LABEL[r.status] as any)}</span>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-[var(--ink)]">{t("patients")} #{r.patientId}</div>
                <div className="text-[11px] text-[var(--ink-muted)] truncate">{r.reason} · {formatDate(r.requestedAt)}</div>
              </div>
              {canReview && r.status === "pending" && (
                <>
                  <button className="btn btn-primary btn-sm h-7" disabled={review.isPending} onClick={() => review.mutate({ id: r.id, data: { action: "approve" } })}>
                    {t("erasureApprove")}
                  </button>
                  <button className="btn btn-outline btn-sm h-7" disabled={review.isPending} onClick={() => review.mutate({ id: r.id, data: { action: "reject" } })}>
                    {t("erasureReject")}
                  </button>
                </>
              )}
              {canExecute && r.status === "approved" && (
                <button className="btn btn-danger btn-sm h-7" onClick={() => { setExecuteTarget(r); setConfirmText(""); }}>
                  {t("erasureExecute")}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Irreversible execute — typed confirmation (super_admin only) */}
      <Dialog open={!!executeTarget} onOpenChange={() => { setExecuteTarget(null); setConfirmText(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-[var(--rose-500)]">
              <Trash2 className="w-4 h-4" /> {t("erasureExecute")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[var(--rose-500)] bg-[var(--rose-50)] border border-[var(--rose-100)] rounded-md p-2.5">
              {t("erasureExecuteWarning")}
            </p>
            <Input
              className="h-8 text-sm"
              placeholder={t("erasureConfirmPlaceholder")}
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <button className="btn btn-outline btn-sm" onClick={() => { setExecuteTarget(null); setConfirmText(""); }}>{t("cancel")}</button>
              <button
                className="btn btn-danger btn-sm"
                disabled={execute.isPending || !executeTarget || confirmText.trim() !== String(executeTarget.patientId)}
                onClick={() => executeTarget && execute.mutate({ id: executeTarget.id })}
              >
                {execute.isPending ? t("loading") : t("erasureExecute")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
