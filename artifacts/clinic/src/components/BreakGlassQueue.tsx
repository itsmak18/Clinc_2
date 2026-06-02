import {
  useListBreakGlassSessions, getListBreakGlassSessionsQueryKey,
  useApproveBreakGlass, useRevokeBreakGlass,
  type BreakGlassSession,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/hooks/i18n";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ShieldAlert } from "lucide-react";

type Status = "revoked" | "expired" | "approved" | "pending";

function statusOf(s: BreakGlassSession): Status {
  if (s.revokedAt) return "revoked";
  if (new Date(s.expiresAt).getTime() < Date.now()) return "expired";
  if (s.approvedAt) return "approved";
  return "pending";
}

const STATUS = {
  revoked:  { tone: "badge-rose", label: "bgStatusRevoked" },
  expired:  { tone: "badge-sand", label: "bgStatusExpired" },
  approved: { tone: "badge-sage", label: "bgStatusApproved" },
  pending:  { tone: "badge-amber", label: "bgStatusPending" },
} as const;

export default function BreakGlassQueue() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const listKey = getListBreakGlassSessionsQueryKey();
  const { data: sessions } = useListBreakGlassSessions(undefined, {
    query: { queryKey: listKey, refetchInterval: 30000 },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: listKey });

  const approve = useApproveBreakGlass({
    mutation: { onSuccess: () => { toast({ title: t("breakGlassApproved") }); invalidate(); }, onError: () => toast({ title: t("failed"), variant: "destructive" }) },
  });
  const revoke = useRevokeBreakGlass({
    mutation: { onSuccess: () => { toast({ title: t("breakGlassRevoked") }); invalidate(); }, onError: () => toast({ title: t("failed"), variant: "destructive" }) },
  });

  return (
    <div className="card card-pad mt-6">
      <div className="flex items-center gap-2 mb-4">
        <ShieldAlert className="w-4 h-4 text-[var(--rose-500)]" />
        <span className="font-semibold text-[var(--ink)] text-[14px]">{t("breakGlassSessions")}</span>
      </div>
      {!sessions || sessions.length === 0 ? (
        <p className="text-[13px] text-[var(--ink-muted)] text-center py-6">{t("noBreakGlassSessions")}</p>
      ) : (
        <div className="space-y-1.5">
          {sessions.map((s) => {
            const st = statusOf(s);
            const cfg = STATUS[st];
            return (
              <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-[var(--line)] text-[13px]">
                <span className={cn("badge text-[10px] flex-shrink-0", cfg.tone)}>{t(cfg.label as any)}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-[var(--ink)]">
                    {t("patients")} #{s.patientId} · user #{s.userId}
                  </div>
                  <div className="text-[11px] text-[var(--ink-muted)] truncate">{s.justification}</div>
                </div>
                <span className="text-[10px] text-[var(--ink-faint)] flex-shrink-0 whitespace-nowrap">
                  {formatDateTime(s.activatedAt)}
                </span>
                {st === "pending" && (
                  <button className="btn btn-primary btn-sm h-7" disabled={approve.isPending} onClick={() => approve.mutate({ sessionId: s.id })}>
                    {t("breakGlassApprove")}
                  </button>
                )}
                {(st === "pending" || st === "approved") && (
                  <button className="btn btn-outline btn-sm h-7 text-[var(--rose-500)]" disabled={revoke.isPending} onClick={() => revoke.mutate({ sessionId: s.id })}>
                    {t("breakGlassRevoke")}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
