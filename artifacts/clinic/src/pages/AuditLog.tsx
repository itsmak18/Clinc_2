import { useState, useMemo } from "react";
import { useListAuditLogs, getListAuditLogsQueryKey, type AuditLog as AuditLogRow } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { BeforeAfterDiff } from "@/components/ChangeHistory";
import DataTable from "@/components/DataTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime, exportToCSV } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Download, Eye, Shield, ShieldAlert, KeyRound } from "lucide-react";

// Tone per action. Anything not listed falls back to a neutral badge.
const ACTION_TONE: Record<string, string> = {
  CREATE: "badge-teal",
  UPDATE: "badge-blue",
  UPSERT: "badge-blue",
  DELETE: "badge-rose",
  CANCEL: "badge-sand",
  APPROVE: "badge-teal",
  READ: "",
  READ_LIST: "",
  AUDIT_LOG_READ: "",
  AUDIT_LOG_EXPORT: "badge-blue",
  LOGIN_SUCCESS: "badge-teal",
  LOGIN_FAILED: "badge-rose",
  LOGIN_LOCKED: "badge-rose",
  LOGIN_PENDING_VERIFICATION: "badge-sand",
  LOGOUT: "",
  CHANGE_PASSWORD: "badge-sand",
  RESET_PASSWORD: "badge-sand",
  TOGGLE_SHIFT: "badge-blue",
  PAY: "badge-teal",
  INVOICE_CANCEL: "badge-rose",
  INVOICE_PAY_FRAUD_GATE: "badge-rose",
  STOCK_ADJUST: "badge-blue",
  SEND_TO_PHARMACY: "badge-blue",
  VOID_PRESCRIPTION: "badge-rose",
  CHECK_IN: "badge-sand",
  TRIAGE_START: "badge-sand",
  TRIAGE_COMPLETE: "badge-blue",
  CONSULTATION_START: "badge-blue",
  DIAGNOSTICS_REQUESTED: "badge-blue",
  PENDING_PAYMENT: "badge-sand",
  COMPLETE: "badge-teal",
  CONSENT_GRANTED: "badge-teal",
  CONSENT_REVOKED: "badge-rose",
  BREAK_GLASS_ACTIVATED: "badge-amber",
  BREAK_GLASS_APPROVED: "badge-amber",
  BREAK_GLASS_ACCESS: "badge-amber",
  ERASURE_REQUESTED: "badge-amber",
  ERASURE_EXECUTED: "badge-rose",
  ACCESS_DENIED_OUT_OF_SCOPE: "badge-rose",
  DENIED: "badge-rose",
  UNAUTHORIZED_EDIT_ATTEMPT: "badge-rose",
  EDIT_LOCKED_DENIED: "badge-rose",
  ESCALATION_DENIED: "badge-rose",
};

// Curated, comprehensive list (grouped by intent). The dropdown unions this with
// any action actually present in the data, so a newly-added action never hides.
const CURATED_ACTIONS = [
  // Auth & session
  "LOGIN_SUCCESS", "LOGIN_FAILED", "LOGIN_LOCKED", "LOGIN_PENDING_VERIFICATION", "LOGOUT",
  "CHANGE_PASSWORD", "RESET_PASSWORD", "TOGGLE_SHIFT", "ESCALATION_DENIED",
  // Data changes
  "CREATE", "UPDATE", "UPSERT", "DELETE", "CANCEL", "APPROVE",
  // PHI access
  "READ", "READ_LIST",
  // Clinical workflow
  "CHECK_IN", "TRIAGE_START", "TRIAGE_COMPLETE", "CONSULTATION_START",
  "DIAGNOSTICS_REQUESTED", "PENDING_PAYMENT", "COMPLETE",
  // Pharmacy / inventory
  "SEND_TO_PHARMACY", "VOID_PRESCRIPTION", "STOCK_ADJUST",
  // Billing
  "PAY", "INVOICE_CANCEL", "INVOICE_PAY_FRAUD_GATE",
  // Compliance
  "CONSENT_GRANTED", "CONSENT_REVOKED",
  "BREAK_GLASS_ACTIVATED", "BREAK_GLASS_APPROVED", "BREAK_GLASS_ACCESS",
  "ERASURE_REQUESTED", "ERASURE_EXECUTED",
  "AUDIT_LOG_READ", "AUDIT_LOG_EXPORT",
  // Denied / security
  "ACCESS_DENIED_OUT_OF_SCOPE", "DENIED", "UNAUTHORIZED_EDIT_ATTEMPT", "EDIT_LOCKED_DENIED",
];

const CURATED_ENTITIES = [
  "patient", "appointment", "medical_record", "prescription", "lab_test",
  "xray", "ultrasound", "invoice", "operation", "inventory", "user",
  "schedule", "doctor_schedule", "consent", "break_glass", "erasure",
  "clinic_notice", "audit_log", "session", "device",
];

const READ_ACTIONS = new Set(["READ", "READ_LIST", "AUDIT_LOG_READ"]);
const SECURITY_ACTIONS = new Set([
  "LOGIN_FAILED", "LOGIN_LOCKED", "RESET_PASSWORD", "CHANGE_PASSWORD",
  "DENIED", "ACCESS_DENIED_OUT_OF_SCOPE", "UNAUTHORIZED_EDIT_ATTEMPT",
  "EDIT_LOCKED_DENIED", "ESCALATION_DENIED", "INVOICE_PAY_FRAUD_GATE",
]);
const BREAK_GLASS_ACTIONS = new Set(["BREAK_GLASS_ACTIVATED", "BREAK_GLASS_APPROVED", "BREAK_GLASS_ACCESS"]);

export default function AuditLog() {
  const { t } = useI18n();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [search, setSearch] = useState("");
  const [hideReads, setHideReads] = useState(false);
  const [selectedLog, setSelectedLog] = useState<AuditLogRow | null>(null);

  const params = {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    action: action || undefined,
    entityType: entityType || undefined,
    limit: 200,
    offset: 0,
  };

  const { data: logs, isLoading } = useListAuditLogs(params, {
    query: { queryKey: getListAuditLogsQueryKey(params) },
  });

  const all = logs ?? [];

  // Union curated lists with whatever the data actually contains.
  const actionOptions = useMemo(
    () => Array.from(new Set([...CURATED_ACTIONS, ...all.map(l => l.action)])).sort(),
    [all],
  );
  const entityOptions = useMemo(
    () => Array.from(new Set([...CURATED_ENTITIES, ...all.map(l => l.entityType).filter(Boolean) as string[]])).sort(),
    [all],
  );

  // Client-side refinement on top of the server filters.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(l => {
      if (hideReads && READ_ACTIONS.has(l.action)) return false;
      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        (l.entityType ?? "").toLowerCase().includes(q) ||
        String(l.entityId ?? "").toLowerCase().includes(q) ||
        (l.user?.fullName ?? "").toLowerCase().includes(q) ||
        (l.user?.username ?? "").toLowerCase().includes(q) ||
        (l.ipAddress ?? "").toLowerCase().includes(q)
      );
    });
  }, [all, search, hideReads]);

  const securityEvents = all.filter(l => SECURITY_ACTIONS.has(l.action)).length;
  const breakGlassEvents = all.filter(l => BREAK_GLASS_ACTIONS.has(l.action)).length;

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
            <SelectTrigger className="h-8 text-sm w-52"><SelectValue placeholder={t("allActions")} /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">{t("allActions")}</SelectItem>
              {actionOptions.map(a => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("entityType")}</Label>
          <Select value={entityType || "all"} onValueChange={v => setEntityType(v === "all" ? "" : v)}>
            <SelectTrigger className="h-8 text-sm w-40"><SelectValue placeholder={t("allEntities")} /></SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="all">{t("allEntities")}</SelectItem>
              {entityOptions.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("search")}</Label>
          <Input className="h-8 text-sm w-52" placeholder={`${t("user")} / ${t("entity")} / IP…`} value={search} onChange={e => setSearch(e.target.value)} data-testid="input-search" />
        </div>
        <label className="flex items-center gap-2 h-8 self-end cursor-pointer">
          <Switch checked={hideReads} onCheckedChange={setHideReads} />
          <span className="text-xs text-[var(--ink-muted)]">{t("hideReads")}</span>
        </label>
        {(dateFrom || dateTo || action || entityType || search || hideReads) && (
          <button
            className="btn btn-ghost btn-sm h-8 self-end"
            onClick={() => { setDateFrom(""); setDateTo(""); setAction(""); setEntityType(""); setSearch(""); setHideReads(false); }}
          >
            {t("clear")}
          </button>
        )}

        <div className="ms-auto flex items-center gap-2 self-end">
          {breakGlassEvents > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--amber-700)] bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
              <KeyRound className="w-3.5 h-3.5" />
              {breakGlassEvents} {t("breakGlassEvents")}
            </div>
          )}
          {securityEvents > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--rose-500)] bg-[var(--rose-50)] border border-[var(--line)] rounded px-2.5 py-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              {securityEvents} {t("securityEvents")}
            </div>
          )}
          <button
            className="btn btn-outline btn-sm gap-1.5"
            onClick={() => exportToCSV(
              filtered.map(l => ({
                Timestamp: new Date(l.createdAt).toISOString(),
                Action: l.action,
                EntityType: l.entityType ?? "",
                EntityId: l.entityId ?? "",
                User: l.user?.fullName ?? l.userId ?? "",
                Username: l.user?.username ?? "",
                Role: (l.user as any)?.role ?? "",
                IP: l.ipAddress ?? "",
              })),
              `audit-log-${new Date().toISOString().split("T")[0]}.csv`
            )}
          >
            <Download className="w-3.5 h-3.5" /> {t("exportCsv")}
          </button>
          <span className="text-xs text-[var(--ink-muted)]">{filtered.length} {t("records")}</span>
        </div>
      </div>

      <div className="card overflow-hidden">
        <DataTable
          isLoading={isLoading}
          data={filtered}
          emptyMessage={t("noAuditLogs")}
          rowClassName={l =>
            SECURITY_ACTIONS.has(l.action) ? "bg-[var(--rose-50)]" :
            BREAK_GLASS_ACTIONS.has(l.action) ? "bg-amber-50" : ""
          }
          columns={[
            {
              key: "action",
              header: t("action"),
              render: l => (
                <span className={cn("badge text-[10px] font-mono whitespace-nowrap", ACTION_TONE[l.action] ?? "")}>
                  {(SECURITY_ACTIONS.has(l.action)) && <ShieldAlert className="w-3 h-3 me-1 inline" />}
                  {BREAK_GLASS_ACTIONS.has(l.action) && <KeyRound className="w-3 h-3 me-1 inline" />}
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
                const hasDetails = l.details && Object.keys(l.details as object).length > 0;
                const hasDiff = !!l.beforeState || !!l.afterState;
                if (!hasDetails && !hasDiff) return null;
                return (
                  <button
                    className="btn btn-ghost btn-sm h-6 w-6 p-0"
                    title={t("viewDetails")}
                    onClick={e => { e.stopPropagation(); setSelectedLog(l); }}
                  >
                    <Eye className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
                  </button>
                );
              },
            },
          ]}
        />
      </div>

      <Dialog open={!!selectedLog} onOpenChange={() => setSelectedLog(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-4 h-4" /> {t("auditEventDetails")}
            </DialogTitle>
          </DialogHeader>
          {selectedLog && <BeforeAfterDiff log={selectedLog} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
