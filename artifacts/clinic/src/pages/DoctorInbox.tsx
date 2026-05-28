import { useListNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, getListNotificationsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { formatDateTime } from "@/lib/api";
import { Bell, BellOff, CheckCheck, FlaskConical, Scan, Activity, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const DOCTOR_RELEVANT_TYPES = new Set([
  "lab_ready",
  "xray_ready",
  "ultrasound_ready",
  "patient_arrived",
]);

const TYPE_BADGES: Record<string, string> = {
  patient_arrived:  "badge-blue",
  lab_ready:        "badge-teal",
  xray_ready:       "badge-sage",
  ultrasound_ready: "badge-sand",
  general:          "",
};

const TYPE_ICONS: Record<string, any> = {
  patient_arrived:  UserCheck,
  lab_ready:        FlaskConical,
  xray_ready:       Scan,
  ultrasound_ready: Activity,
};

export default function DoctorInbox() {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const { data: notifications, isLoading } = useListNotifications({}, { query: { queryKey: getListNotificationsQueryKey({}) } });

  const markReadMutation = useMarkNotificationRead({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) }
  });

  const markAllMutation = useMarkAllNotificationsRead({
    mutation: { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }) }
  });

  const scoped = (notifications ?? []).filter(n => DOCTOR_RELEVANT_TYPES.has(n.type) || n.type === "general");
  const unreadCount = scoped.filter(n => !n.isRead).length;

  return (
    <div className="page">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex-1">
          <h1 className="font-semibold text-[var(--ink)] text-[15px]">{t("doctorInbox")}</h1>
          {unreadCount > 0 && (
            <p className="text-[12px] text-[var(--ink-muted)]">{unreadCount} {t("unread")}</p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            className="btn btn-outline btn-sm gap-1.5"
            onClick={() => markAllMutation.mutate()}
            disabled={markAllMutation.isPending}
            aria-label={t("markAllRead")}
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="w-3.5 h-3.5" /> {t("markAllRead")}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2" role="status" aria-label={t("loading")}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 rounded-lg bg-[var(--surface-2)] animate-pulse" />
          ))}
        </div>
      ) : !scoped.length ? (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--ink-muted)]" role="status">
          <BellOff className="w-8 h-8 mb-3 opacity-30" />
          <p className="text-sm">{t("noNotifications")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {scoped.map(notif => {
            const Icon = TYPE_ICONS[notif.type] ?? Bell;
            return (
              <div
                key={notif.id}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                  notif.isRead
                    ? "bg-[var(--surface)] border-[var(--line)] opacity-60"
                    : "bg-[var(--surface)] border-[var(--teal-600)]/20 shadow-sm"
                )}
                data-testid={`notification-${notif.id}`}
              >
                <Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", notif.isRead ? "text-[var(--ink-muted)]" : "text-[var(--teal-600)]")} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-[var(--ink)]">{notif.title}</p>
                    <span className={cn("badge text-[10px] px-1.5 py-0", TYPE_BADGES[notif.type] ?? "")}>
                      {notif.type.replace(/_/g, " ")}
                    </span>
                    {!notif.isRead && <div className="w-2 h-2 rounded-full bg-[var(--teal-600)] flex-shrink-0" aria-hidden="true" />}
                  </div>
                  <p className="text-xs text-[var(--ink-muted)] mt-0.5">{notif.message}</p>
                  <p className="text-[11px] text-[var(--ink-muted)]/70 mt-1">{formatDateTime(notif.createdAt)}</p>
                </div>
                {!notif.isRead && (
                  <button
                    className="btn btn-ghost btn-sm h-6 text-xs px-2 flex-shrink-0"
                    onClick={() => markReadMutation.mutate({ notificationId: notif.id })}
                    aria-label={t("markRead")}
                    data-testid={`button-mark-read-${notif.id}`}
                  >
                    {t("markRead")}
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
