import { type ScheduleOverride } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { Trash2 } from "lucide-react";

interface Props {
  overrides: ScheduleOverride[];
  canEdit: boolean;
  doctorId: number;
  onDelete: (doctorId: number, date: string) => void;
}

export function OverridesTable({ overrides, canEdit, doctorId, onDelete }: Props) {
  const { t } = useI18n();

  const sorted = [...overrides].sort((a, b) => a.overrideDate.localeCompare(b.overrideDate));

  if (sorted.length === 0) {
    return <p className="p-4 text-sm text-[var(--ink-muted)]">{t("noOverrides")}</p>;
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs text-[var(--ink-muted)] border-b border-[var(--line)]">
          <th className="px-4 py-2 text-start">{t("date")}</th>
          <th className="px-4 py-2 text-start">{t("status")}</th>
          <th className="px-4 py-2 text-start">{t("notes")}</th>
          {canEdit && <th className="px-4 py-2 text-start">{t("actions")}</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--line)]">
        {sorted.map((ov) => (
          <tr key={ov.id} className="hover:bg-[var(--surface-2)]">
            <td className="px-4 py-2 font-mono text-xs text-[var(--ink)]">{ov.overrideDate}</td>
            <td className="px-4 py-2">
              {ov.isBlocked ? (
                <span className="badge badge-rose text-xs">{t("dayOff")}</span>
              ) : (
                <span className="badge text-xs">
                  {ov.startTime?.slice(0, 5)} – {ov.endTime?.slice(0, 5)}
                </span>
              )}
            </td>
            <td className="px-4 py-2 text-[var(--ink-muted)]">{ov.reason ?? "—"}</td>
            {canEdit && (
              <td className="px-4 py-2">
                <button
                  className="btn btn-ghost btn-sm h-7 w-7 p-0 text-[var(--rose-500)]"
                  onClick={() => onDelete(doctorId, ov.overrideDate)}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
