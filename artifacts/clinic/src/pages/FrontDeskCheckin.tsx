import { useState } from "react";
import { useGetTodayAppointments, useCheckInPatient, getGetTodayAppointmentsQueryKey, getListAppointmentsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import StatusBadge from "@/components/StatusBadge";
import { flowLabel } from "@/lib/appointment-flow";
import { formatDateTime } from "@/lib/api";
import { UserCheck, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export default function FrontDeskCheckin() {
  const { t } = useI18n();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");

  const { data: appts, isLoading } = useGetTodayAppointments({
    query: { queryKey: getGetTodayAppointmentsQueryKey() }
  });

  const checkInMutation = useCheckInPatient({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetTodayAppointmentsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListAppointmentsQueryKey() });
        toast({ title: t("checkedInSuccessfully") });
      },
      onError: () => toast({ title: t("checkinFailed"), variant: "destructive" }),
    },
  });

  const all = (appts as any)?.appointments ?? [];
  const pending = all.filter((a: any) => a.status === "scheduled");
  const filtered = pending.filter((a: any) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.patient?.fullName?.toLowerCase().includes(q) ||
      (a.patient as any)?.mrn?.toLowerCase().includes(q) ||
      a.reason?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1">
          <h1 className="font-semibold text-[var(--ink)] text-[15px]">{t("patientCheckin")}</h1>
          <p className="text-[12px] text-[var(--ink-muted)]">{pending.length} {t("noAppointmentsAwaitingCheckin").includes("لا") ? "" : "pending"}</p>
        </div>
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)] pointer-events-none" />
        <Input
          className="h-9 text-sm ps-9"
          placeholder={t("searchAppointmentsByPatient")}
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label={t("searchAppointmentsByPatient")}
          data-testid="input-checkin-search"
        />
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="card-pad space-y-2" role="status" aria-label={t("loading")}>
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 rounded bg-[var(--surface-2)] animate-pulse" />
            ))}
          </div>
        ) : !filtered.length ? (
          <div className="card-pad text-center text-sm text-[var(--ink-muted)] py-12" role="status">
            {t("noAppointmentsAwaitingCheckin")}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {filtered.map((a: any) => (
              <li key={a.id} className={cn("flex items-center gap-3 card-pad hover:bg-[var(--surface-2)]")} data-testid={`checkin-row-${a.id}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-[13px] text-[var(--ink)]">{a.patient?.fullName || `#${a.patientId}`}</span>
                    {(a.patient as any)?.mrn && (
                      <span className="text-[11px] font-mono text-[var(--ink-muted)]">{(a.patient as any).mrn}</span>
                    )}
                    <StatusBadge status={a.status} label={flowLabel(t, a.status)} />
                  </div>
                  <p className="text-[12px] text-[var(--ink-muted)] mt-0.5">
                    {a.reason} · {a.doctor?.fullName} · {formatDateTime(a.scheduledAt)}
                  </p>
                </div>
                <button
                  className="btn btn-primary btn-sm gap-1.5 shrink-0"
                  onClick={() => checkInMutation.mutate({ appointmentId: a.id })}
                  disabled={checkInMutation.isPending}
                  aria-label={t("confirmCheckin")}
                  data-testid={`button-checkin-${a.id}`}
                >
                  <UserCheck className="w-3.5 h-3.5" /> {t("confirmCheckin")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
