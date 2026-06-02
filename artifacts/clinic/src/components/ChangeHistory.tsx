import { useState } from "react";
import { useGetAuditLogsByEntity, getGetAuditLogsByEntityQueryKey, type AuditLog } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { formatDateTime } from "@/lib/api";
import { computeDiff, formatValue } from "@/lib/auditDiff";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronRight, History } from "lucide-react";

const STATUS_TONE: Record<string, string> = {
  added: "text-[var(--teal-600)]",
  removed: "text-[var(--rose-500)]",
  changed: "text-[var(--ink)]",
};

/**
 * Renders a before→after field-level diff for one audit entry.
 * Falls back to `details` (or a "no changes" line) when no before/after snapshot.
 */
export function BeforeAfterDiff({ log }: { log: AuditLog }) {
  const { t } = useI18n();
  const before = log.beforeState ?? null;
  const after = log.afterState ?? null;
  const rows = computeDiff(before, after);

  if (rows.length === 0) {
    if (log.details && Object.keys(log.details as object).length > 0) {
      return (
        <pre className="text-xs bg-[var(--surface-2)] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed text-[var(--ink)]">
          {JSON.stringify(log.details, null, 2)}
        </pre>
      );
    }
    return <p className="text-xs text-[var(--ink-muted)] italic px-1 py-2">{t("noFieldChanges")}</p>;
  }

  return (
    <table className="w-full text-xs border-collapse">
      <thead>
        <tr className="text-[var(--ink-muted)]">
          <th className="text-start font-medium pb-1.5 pe-3">{t("fieldChanges")}</th>
          <th className="text-start font-medium pb-1.5 pe-3">{t("beforeLabel")}</th>
          <th className="text-start font-medium pb-1.5">{t("afterLabel")}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.key} className="border-t border-[var(--line)] align-top">
            <td className={cn("py-1.5 pe-3 font-mono font-medium whitespace-nowrap", STATUS_TONE[r.status])}>{r.key}</td>
            <td className="py-1.5 pe-3 text-[var(--rose-500)] break-words max-w-[180px]">{formatValue(r.before)}</td>
            <td className="py-1.5 text-[var(--teal-600)] break-words max-w-[180px]">{formatValue(r.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Chronological change-history timeline for a single record (who / when /
 * before→after). Backed by GET /audit-logs/entity/{type}/{id}, which is gated
 * server-side to super_admin + compliance_officer — render only for those roles.
 */
export function ChangeHistory({ entityType, entityId }: { entityType: string; entityId: string | number }) {
  const { t } = useI18n();
  const id = String(entityId);
  const { data: logs, isLoading } = useGetAuditLogsByEntity(entityType, id, {
    query: { enabled: !!id, queryKey: getGetAuditLogsByEntityQueryKey(entityType, id) },
  });
  const [expanded, setExpanded] = useState<number | null>(null);

  if (isLoading) return <p className="text-xs text-[var(--ink-muted)] px-1 py-2">{t("loading")}</p>;
  if (!logs || logs.length === 0) {
    return <p className="text-xs text-[var(--ink-muted)] italic px-1 py-2">{t("noChangeHistory")}</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {logs.map(log => {
        const open = expanded === log.id;
        return (
          <div key={log.id} className="border border-[var(--line)] rounded-md overflow-hidden">
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-start hover:bg-[var(--surface-2)]"
              onClick={() => setExpanded(open ? null : log.id)}
            >
              {open ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
              <span className="badge badge-blue text-[10px] font-mono whitespace-nowrap">{log.action}</span>
              <span className="text-[13px] text-[var(--ink)] truncate">
                {log.user?.fullName || t("unknown")}
              </span>
              <span className="ms-auto text-[11px] text-[var(--ink-muted)] whitespace-nowrap">
                {formatDateTime(log.createdAt)}
              </span>
            </button>
            {open && (
              <div className="px-3 py-2.5 border-t border-[var(--line)] bg-[var(--surface)] overflow-x-auto">
                <BeforeAfterDiff log={log} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ChangeHistoryCard({ entityType, entityId }: { entityType: string; entityId: string | number }) {
  const { t } = useI18n();
  return (
    <div className="card card-pad">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)] mb-3">
        <History className="w-4 h-4" /> {t("changeHistory")}
      </h3>
      <ChangeHistory entityType={entityType} entityId={entityId} />
    </div>
  );
}
