import { useState } from "react";
import { useListAuditLogs, getListAuditLogsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/api";

export default function AuditLog() {
  const { t } = useI18n();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [action, setAction] = useState("");

  const params = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    action: action || undefined,
    limit: 100,
    offset: 0,
  };

  const { data: logs, isLoading } = useListAuditLogs(params, { query: { queryKey: getListAuditLogsQueryKey(params) } });

  const actionColors: Record<string, string> = {
    CREATE: "bg-green-100 text-green-800",
    UPDATE: "bg-blue-100 text-blue-800",
    DELETE: "bg-red-100 text-red-800",
    READ: "bg-gray-100 text-gray-700",
    LOGIN: "bg-purple-100 text-purple-800",
    LOGOUT: "bg-orange-100 text-orange-800",
  };

  return (
    <div>
      <PageHeader title={t("audit")} subtitle="Complete audit trail of all system actions" />
      <div className="p-6">
        <div className="flex gap-3 mb-4 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs">{t("dateFrom")}</Label>
            <Input type="date" className="h-8 text-sm w-36" value={dateFrom} onChange={e => setDateFrom(e.target.value)} data-testid="input-date-from" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("dateTo")}</Label>
            <Input type="date" className="h-8 text-sm w-36" value={dateTo} onChange={e => setDateTo(e.target.value)} data-testid="input-date-to" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Action</Label>
            <Input className="h-8 text-sm w-28" placeholder="CREATE, UPDATE..." value={action} onChange={e => setAction(e.target.value)} data-testid="input-action" />
          </div>
        </div>
        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={logs ?? []}
            emptyMessage="No audit logs"
            columns={[
              { key: "action", header: "Action", render: l => (
                <Badge className={`text-xs border-none ${actionColors[l.action] || "bg-gray-100 text-gray-700"}`}>
                  {l.action}
                </Badge>
              )},
              { key: "entity", header: "Entity", render: l => (
                <div>
                  <span className="font-medium text-sm">{l.entityType}</span>
                  {l.entityId && <span className="text-muted-foreground text-xs"> #{l.entityId}</span>}
                </div>
              )},
              { key: "user", header: "User", render: l => (
                <div>
                  <div className="text-sm">{l.user?.fullName || `#${l.userId}`}</div>
                  <div className="text-xs text-muted-foreground">{l.ipAddress}</div>
                </div>
              )},
              { key: "time", header: "Timestamp", render: l => <span className="text-sm">{formatDateTime(l.createdAt)}</span> },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
