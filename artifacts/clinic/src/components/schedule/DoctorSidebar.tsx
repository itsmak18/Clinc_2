import { type DoctorScheduleSummary } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { DoctorAvatar } from "@/components/DoctorAvatar";
import { cn } from "@/lib/utils";

interface Props {
  doctors: DoctorScheduleSummary[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export function DoctorSidebar({ doctors, loading, selectedId, onSelect }: Props) {
  const { t } = useI18n();

  return (
    <div className="card overflow-hidden">
      <div className="card-pad border-b border-[var(--line)] bg-[var(--surface-2)]">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
          {t("selectDoctor")}
        </p>
      </div>
      {loading ? (
        <p className="p-3 text-sm text-[var(--ink-muted)]">{t("loading")}</p>
      ) : doctors.length === 0 ? (
        <p className="p-3 text-sm text-[var(--ink-muted)]">{t("noData")}</p>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {doctors.map((doc) => (
            <li key={doc.id}>
              <button
                onClick={() => onSelect(doc.id)}
                className={cn(
                  "w-full flex items-start gap-2.5 text-start px-3 py-2.5 text-sm transition-colors hover:bg-[var(--surface-2)]",
                  selectedId === doc.id
                    ? "bg-[var(--teal-50)] border-s-2 border-[var(--teal-600)] font-medium"
                    : "",
                )}
              >
                <DoctorAvatar id={doc.id} name={doc.fullName} size={28} />
                <div className="min-w-0">
                  <div className="font-medium leading-tight text-[var(--ink)] truncate">{doc.fullName}</div>
                  {doc.specialty && (
                    <div className="text-xs text-[var(--ink-muted)] mt-0.5 truncate">{doc.specialty}</div>
                  )}
                  <div className="mt-1">
                    <span className={cn("badge text-[10px] px-1 py-0", doc.isOnShift ? "badge-teal" : "")}>
                      {doc.isOnShift ? t("onShift") : t("offShift")}
                    </span>
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
