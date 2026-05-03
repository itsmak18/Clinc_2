import { useState } from "react";
import { useListAuditLogs, getListAuditLogsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import PageHeader from "@/components/PageHeader";
import DataTable from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime, exportToCSV } from "@/lib/api";
import { Download, Eye, Shield, ShieldAlert } from "lucide-react";

const ACTION_COLORS: Record<string, string> = {
  CREATE:               "bg-green-100 text-green-800",
  UPDATE:               "bg-blue-100 text-blue-800",
  DELETE:               "bg-red-100 text-red-800",
  CANCEL:               "bg-orange-100 text-orange-800",
  READ:                 "bg-gray-100 text-gray-700",
  LOGIN_SUCCESS:        "bg-purple-100 text-purple-800",
  LOGIN_FAILED:         "bg-red-200 text-red-900",
  LOGIN_LOCKED:         "bg-red-300 text-red-950",
  LOGOUT:               "bg-slate-100 text-slate-700",
  PAY:                  "bg-emerald-100 text-emerald-800",
  CHECK_IN:             "bg-yellow-100 text-yellow-800",
  TRIAGE_START:         "bg-orange-100 text-orange-800",
  TRIAGE_COMPLETE:      "bg-blue-100 text-blue-800",
  CONSULTATION_START:   "bg-indigo-100 text-indigo-800",
  DIAGNOSTICS_REQUESTED:"bg-purple-100 text-purple-800",
  PENDING_PAYMENT:      "bg-pink-100 text-pink-800",
  COMPLETE:             "bg-green-100 text-green-800",
  RESET_PASSWORD:       "bg-amber-100 text-amber-800",
  TOGGLE_SHIFT:         "bg-cyan-100 text-cyan-800",
};

const ENTITY_TYPES = [
  "patient", "appointment", "medical_record", "prescription",
  "lab_test", "xray", "invoice", "user", "session", "inventory", "operation",
];

const ALL_ACTIONS = [
  "LOGIN_SUCCESS", "LOGIN_FAILED", "LOGIN_LOCKED", "LOGOUT",
  "CREATE", "UPDATE", "DELETE", "CANCEL",
  "CHECK_IN", "TRIAGE_START", "TRIAGE_COMPLETE", "CONSULTATION_START",
  "DIAGNOSTICS_REQUESTED", "PENDING_PAYMENT", "COMPLETE", "PAY",
  "RESET_PASSWORD", "TOGGLE_SHIFT",
];

export default function AuditLog() {
  const { t } = useI18n();
  const [dateFrom, setDateFrom]   = useState("");
  const [dateTo, setDateTo]       = useState("");
  const [action, setAction]       = useState("");
  const [entityType, setEntityType] = useState("");
  const [detailsRow, setDetailsRow] = useState<object | null>(null);

  const params = {
    dateFrom:   dateFrom    || undefined,
    dateTo:     dateTo      || undefined,
    action:     action      || undefined,
    entityType: entityType  || undefined,
    limit: 200,
    offset: 0,
  };

  const { data: logs, isLoading } = useListAuditLogs(params, {
    query: { queryKey: getListAuditLogsQueryKey(params) }
  });

  const securityEvents = (logs ?? []).filter(l =>
    ["LOGIN_FAILED", "LOGIN_LOCKED", "RESET_PASSWORD"].includes(l.action)
  ).length;

  return (
    <div>
      <PageHeader
        title={t("audit")}
        subtitle="Complete audit trail of all system actions"
        actions={
          <div className="flex gap-2 items-center">
            {securityEvents > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                {securityEvents} security {securityEvents === 1 ? "event" : "events"}
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => exportToCSV(
              (logs ?? []).map(l => ({
                Timestamp:  new Date(l.createdAt).toISOString(),
                Action:     l.action,
                EntityType: l.entityType ?? "",
                EntityId:   l.entityId ?? "",
                User:       l.user?.fullName ?? l.userId ?? "",
                Username:   l.user?.username ?? "",
                Role:       (l.user as any)?.role ?? "",
                IP:         l.ipAddress ?? "",
              })),
              `audit-log-${new Date().toISOString().split("T")[0]}.csv`
            )}>
              <Download className="w-3.5 h-3.5 me-1" /> Export CSV
            </Button>
          </div>
        }
      />
      <div className="p-6">
        {/* Filters */}
        <div className="flex gap-3 mb-4 flex-wrap items-end">
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
            <Select value={action || "all"} onValueChange={v => setAction(v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-sm w-44"><SelectValue placeholder="All actions" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {ALL_ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Entity Type</Label>
            <Select value={entityType || "all"} onValueChange={v => setEntityType(v === "all" ? "" : v)}>
              <SelectTrigger className="h-8 text-sm w-36"><SelectValue placeholder="All entities" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All entities</SelectItem>
                {ENTITY_TYPES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {(dateFrom || dateTo || action || entityType) && (
            <Button variant="ghost" size="sm" className="h-8 self-end" onClick={() => { setDateFrom(""); setDateTo(""); setAction(""); setEntityType(""); }}>
              Clear
            </Button>
          )}
          <span className="text-xs text-muted-foreground self-end ms-auto">{logs?.length ?? 0} records</span>
        </div>

        <div className="bg-card rounded-lg border border-border overflow-hidden">
          <DataTable
            isLoading={isLoading}
            data={logs ?? []}
            emptyMessage="No audit logs matching filters"
            rowClassName={l =>
              ["LOGIN_FAILED", "LOGIN_LOCKED"].includes(l.action) ? "bg-red-50/60 dark:bg-red-950/10" : ""
            }
            columns={[
              { key: "action", header: "Action", render: l => (
                <Badge className={`text-xs border-none font-mono whitespace-nowrap ${ACTION_COLORS[l.action] ?? "bg-gray-100 text-gray-700"}`}>
                  {["LOGIN_FAILED", "LOGIN_LOCKED"].includes(l.action) && <ShieldAlert className="w-3 h-3 me-1 inline" />}
                  {l.action}
                </Badge>
              )},
              { key: "entity", header: "Entity", render: l => (
                <div>
                  <span className="font-medium text-sm capitalize">{l.entityType?.replace(/_/g, " ") ?? "—"}</span>
                  {l.entityId && <span className="text-muted-foreground text-xs"> #{l.entityId}</span>}
                </div>
              )},
              { key: "user", header: "User", render: l => (
                <div>
                  <div className="text-sm font-medium">{l.user?.fullName || <span className="text-muted-foreground italic">Unknown</span>}</div>
                  <div className="text-xs text-muted-foreground font-mono">{l.user?.username ?? ""}</div>
                  <div className="text-xs text-muted-foreground">{l.ipAddress}</div>
                </div>
              )},
              { key: "time", header: "Timestamp", render: l => (
                <span className="text-sm text-muted-foreground whitespace-nowrap">{formatDateTime(l.createdAt)}</span>
              )},
              { key: "details", header: "", render: l => {
                if (!l.details || Object.keys(l.details as object).length === 0) return null;
                return (
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" title="View details"
                    onClick={e => { e.stopPropagation(); setDetailsRow(l.details as object); }}>
                    <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                  </Button>
                );
              }},
            ]}
          />
        </div>
      </div>

      {/* Details dialog */}
      <Dialog open={!!detailsRow} onOpenChange={() => setDetailsRow(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4" /> Audit Event Details
            </DialogTitle>
          </DialogHeader>
          <pre className="text-xs bg-muted rounded-md p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
            {JSON.stringify(detailsRow, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
