import { useState } from "react";
import { useListAuditLogs, getListAuditLogsQueryKey } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import DataTable from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime, exportToCSV } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Download, Eye, Shield, ShieldAlert } from "lucide-react";

const ACTION_TONE: Record<string, string> = {
  CREATE:                "badge-teal",
  UPDATE:                "badge-blue",
  DELETE:                "badge-rose",
  CANCEL:                "badge-sand",
  READ:                  "",
  LOGIN_SUCCESS:         "badge-teal",
  LOGIN_FAILED:          "badge-rose",
  LOGIN_LOCKED:          "badge-rose",
  LOGOUT:                "",
  PAY:                   "badge-teal",
  CHECK_IN:              "badge-sand",
  TRIAGE_START:          "badge-sand",
  TRIAGE_COMPLETE:       "badge-blue",
  CONSULTATION_START:    "badge-blue",
  DIAGNOSTICS_REQUESTED: "badge-blue",
  PENDING_PAYMENT:       "badge-sand",
  COMPLETE:              "badge-teal",
  RESET_PASSWORD:        "badge-sand",
  TOGGLE_SHIFT:          "badge-blue",
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
  const [dateFrom,   setDateFrom]   = useState("");
  const [dateTo,     setDateTo]     = useState("");
  const [action,     setAction]     = useState("");
  const [entityType, setEntityType] = useState("");
  const [detailsRow, setDetailsRow] = useState<object | null>(null);

  const params = {
    dateFrom:   dateFrom   || undefined,
    dateTo:     dateTo     || undefined,
    action:     action     || undefined,
    entityType: entityType || undefined,
    limit: 200,
    offset: 0,
  };

  const { data: logs, isLoading } = useListAuditLogs(params, {
    query: { queryKey: getListAuditLogsQueryKey(params) },
  });

  const securityEvents = (logs ?? []).filter(l =>
    ["LOGIN_FAILED", "LOGIN_LOCKED", "RESET_PASSWORD"].includes(l.action)
  ).length;

  return (
    <div className="page">
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
          <Label className="text-xs">{t("action")}</Label>
          <Select value={action || "all"} onValueChange={v => setAction(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm w-44"><SelectValue placeholder={t("allActions")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allActions")}</SelectItem>
              {ALL_ACTIONS.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("entityType")}</Label>
          <Select value={entityType || "all"} onValueChange={v => setEntityType(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm w-36"><SelectValue placeholder={t("allEntities")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allEntities")}</SelectItem>
              {ENTITY_TYPES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {(dateFrom || dateTo || action || entityType) && (
          <button
            className="btn btn-ghost btn-sm h-8 self-end"
            onClick={() => { setDateFrom(""); setDateTo(""); setAction(""); setEntityType(""); }}
          >
            {t("clear")}
          </button>
        )}

        <div className="ms-auto flex items-center gap-2 self-end">
          {securityEvents > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--amber-700)] bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              {securityEvents} {t("securityEvents")}
            </div>
          )}
          <button
            className="btn btn-outline btn-sm gap-1.5"
            onClick={() => exportToCSV(
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
            )}
          >
            <Download className="w-3.5 h-3.5" /> {t("exportCsv")}
          </button>
          <span className="text-xs text-[var(--ink-muted)]">{logs?.length ?? 0} {t("records")}</span>
        </div>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          data={logs ?? []}
          emptyMessage={t("noAuditLogs")}
          rowClassName={l =>
            ["LOGIN_FAILED", "LOGIN_LOCKED"].includes(l.action) ? "bg-[var(--rose-50)]" : ""
          }
          columns={[
            {
              key: "action",
              header: t("action"),
              render: l => (
                <span className={cn("badge text-[10px] font-mono whitespace-nowrap", ACTION_TONE[l.action] ?? "")}>
                  {["LOGIN_FAILED", "LOGIN_LOCKED"].includes(l.action) && <ShieldAlert className="w-3 h-3 me-1 inline" />}
                  {l.action}
                </span>
              ),
            },
            {
              key: "entity",
              header: t("entity"),
              render: l => (
                <div>
                  <span className="font-medium text-[13px] text-[var(--ink)] capitalize">{l.entityType?.replace(/_/g, " ") ?? "—"}</span>
                  {l.entityId && <span className="text-[var(--ink-muted)] text-[11px]"> #{l.entityId}</span>}
                </div>
              ),
            },
            {
              key: "user",
              header: t("user"),
              render: l => (
                <div>
                  <div className="text-[13px] font-medium text-[var(--ink)]">{l.user?.fullName || <span className="text-[var(--ink-faint)] italic">{t("unknown")}</span>}</div>
                  <div className="text-[11px] text-[var(--ink-muted)] font-mono">{l.user?.username ?? ""}</div>
                  <div className="text-[11px] text-[var(--ink-muted)]">{l.ipAddress}</div>
                </div>
              ),
            },
            {
              key: "time",
              header: t("timestamp"),
              render: l => <span className="text-[12px] text-[var(--ink-muted)] whitespace-nowrap">{formatDateTime(l.createdAt)}</span>,
            },
            {
              key: "details",
              header: "",
              render: l => {
                if (!l.details || Object.keys(l.details as object).length === 0) return null;
                return (
                  <button
                    className="btn btn-ghost btn-sm h-6 w-6 p-0"
                    title={t("viewDetails")}
                    onClick={e => { e.stopPropagation(); setDetailsRow(l.details as object); }}
                  >
                    <Eye className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
                  </button>
                );
              },
            },
          ]}
        />
      </div>

      <Dialog open={!!detailsRow} onOpenChange={() => setDetailsRow(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4" /> {t("auditEventDetails")}
            </DialogTitle>
          </DialogHeader>
          <pre className="text-xs bg-[var(--surface-2)] rounded-lg p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed text-[var(--ink)]">
            {JSON.stringify(detailsRow, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
