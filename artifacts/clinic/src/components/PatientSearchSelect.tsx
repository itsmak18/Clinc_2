import { useEffect, useState } from "react";
import { useListPatients, getListPatientsQueryKey } from "@workspace/api-client-react";
import type { Patient } from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Search, X, UserRound } from "lucide-react";

/** Minimum characters before we hit the server — name OR id OR phone OR MRN. */
const MIN_CHARS = 3;

interface PatientSearchSelectProps {
  /** Selected patient id as a string ("" = none). */
  value: string;
  /** Called with the new id (and the Patient object when picked from results). */
  onChange: (patientId: string, patient?: Patient) => void;
  /** Display name when `value` is set externally (e.g. a quick-pick) and we have no cached object. */
  selectedName?: string;
  placeholder?: string;
  className?: string;
  testId?: string;
}

/**
 * Type-ahead patient picker. Replaces the old "render all 200 patients in a
 * <Select>" pattern: searches by name / ID / MRN / phone via the server `search`
 * param, and only queries once at least {@link MIN_CHARS} characters are typed.
 * Doctor scope is enforced server-side, so doctors only ever match their own patients.
 */
export default function PatientSearchSelect({
  value, onChange, selectedName, placeholder, className, testId,
}: PatientSearchSelectProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [picked, setPicked] = useState<Patient | null>(null);

  // Debounce keystrokes so we don't fire a request per character.
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  // If the parent clears the value, drop the cached patient too.
  useEffect(() => {
    if (!value) setPicked(null);
  }, [value]);

  const enabled = debounced.length >= MIN_CHARS;
  const { data, isFetching } = useListPatients(
    { search: debounced, limit: 20 },
    { query: { enabled, queryKey: getListPatientsQueryKey({ search: debounced, limit: 20 }) } },
  );

  const select = (p: Patient) => {
    setPicked(p);
    setQuery("");
    setDebounced("");
    onChange(String(p.id), p);
  };

  const clear = () => {
    setPicked(null);
    onChange("");
  };

  // ── Selected state ──────────────────────────────────────────────
  if (value) {
    const name = picked?.id === Number(value) ? picked.fullName : (selectedName ?? `#${value}`);
    return (
      <div className={cn(
        "flex h-9 items-center justify-between gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-3",
        className,
      )}>
        <span className="text-sm text-[var(--ink)] inline-flex items-center gap-2 min-w-0">
          <UserRound className="w-3.5 h-3.5 text-[var(--teal-600)] flex-shrink-0" />
          <span className="truncate">{name}</span>
          <span className="text-[11px] text-[var(--ink-muted)] font-mono flex-shrink-0">#{value}</span>
        </span>
        <button
          type="button"
          onClick={clear}
          className="btn btn-ghost btn-sm gap-1 flex-shrink-0"
          aria-label={t("change")}
          data-testid="button-change-patient"
        >
          <X className="w-3.5 h-3.5" /> {t("change")}
        </button>
      </div>
    );
  }

  // ── Search state ────────────────────────────────────────────────
  const tooShort = query.trim().length > 0 && query.trim().length < MIN_CHARS;
  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-2.5 text-[var(--ink-faint)] pointer-events-none" />
        <Input
          className="h-9 text-sm ps-8"
          placeholder={placeholder ?? t("patientSearchPlaceholder")}
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoComplete="off"
          data-testid={testId ?? "input-patient-search"}
        />
      </div>
      {tooShort && (
        <p className="text-[11px] text-[var(--ink-faint)] pt-1 ps-1">{t("patientSearchMinChars")}</p>
      )}
      {enabled && (
        <div className="mt-1 border border-[var(--line)] rounded-[var(--r-sm)] overflow-hidden max-h-60 overflow-y-auto bg-[var(--surface)] shadow-sm">
          {isFetching && !data ? (
            <div className="px-3 py-2 text-[12px] text-[var(--ink-muted)]">{t("loading")}</div>
          ) : !data?.patients?.length ? (
            <div className="px-3 py-2 text-[12px] text-[var(--ink-muted)]">{t("noResults")}</div>
          ) : (
            data.patients.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => select(p)}
                className="w-full text-start px-3 py-2 hover:bg-[var(--surface-2)] border-b border-[var(--line)] last:border-b-0 flex items-center justify-between gap-2"
                data-testid={`patient-result-${p.id}`}
              >
                <span className="text-[13px] text-[var(--ink)] truncate">{p.fullName}</span>
                <span className="text-[11px] text-[var(--ink-faint)] font-mono whitespace-nowrap">#{p.id} · {p.phone}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
