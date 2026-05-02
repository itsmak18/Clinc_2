import { useListNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, getListNotificationsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { useQueryClient } from "@tanstack/react-query";
import PageHeader from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/api";
import { Bell, BellOff, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export default function Notifications() {
  const { t } = useI18n();
  const queryClient = useQueryClient();

  const { data: notifications, isLoading } = useListNotifications({}, { query: { queryKey: getListNotificationsQueryKey({}) } });

  const markReadMutation = useMarkNotificationRead({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
    }
  });

  const markAllMutation = useMarkAllNotificationsRead({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
    }
  });

  const typeColors: Record<string, string> = {
    patient_arrived: "bg-blue-100 text-blue-700",
    lab_ready: "bg-green-100 text-green-700",
    xray_ready: "bg-purple-100 text-purple-700",
    general: "bg-gray-100 text-gray-700",
  };

  const unreadCount = notifications?.filter(n => !n.isRead).length ?? 0;

  return (
    <div>
      <PageHeader
        title={t("notifications")}
        subtitle={`${unreadCount} unread`}
        actions={
          unreadCount > 0 ? (
            <Button size="sm" variant="outline" onClick={() => markAllMutation.mutate()} disabled={markAllMutation.isPending} data-testid="button-mark-all-read">
              <CheckCheck className="w-3.5 h-3.5 me-1" /> Mark All Read
            </Button>
          ) : undefined
        }
      />
      <div className="p-6">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}
          </div>
        ) : !notifications?.length ? (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <BellOff className="w-8 h-8 mb-3 opacity-30" />
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          <div className="space-y-2">
            {notifications.map(notif => (
              <div
                key={notif.id}
                className={cn(
                  "flex items-start gap-3 p-3 rounded-lg border transition-colors",
                  notif.isRead
                    ? "bg-card border-border opacity-60"
                    : "bg-card border-primary/20 shadow-xs"
                )}
                data-testid={`notification-${notif.id}`}
              >
                <Bell className={cn("w-4 h-4 mt-0.5 flex-shrink-0", notif.isRead ? "text-muted-foreground" : "text-primary")} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn("text-sm font-medium", !notif.isRead && "text-foreground")}>{notif.title}</p>
                    <Badge className={cn("text-[10px] px-1.5 py-0 border-none", typeColors[notif.type] || typeColors.general)}>
                      {notif.type.replace(/_/g, " ")}
                    </Badge>
                    {!notif.isRead && <div className="w-2 h-2 rounded-full bg-primary flex-shrink-0" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{notif.message}</p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1">{formatDateTime(notif.createdAt)}</p>
                </div>
                {!notif.isRead && (
                  <Button size="sm" variant="ghost" className="h-6 text-xs px-2 flex-shrink-0" onClick={() => markReadMutation.mutate({ notificationId: notif.id })} data-testid={`button-mark-read-${notif.id}`}>
                    Mark read
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
