import { useEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { Search, ChevronRight } from "lucide-react";
import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { navItems, type NavItem } from "@/lib/route-access";
import { useListPatients, getListPatientsQueryKey } from "@workspace/api-client-react";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

interface Result {
  id: string;
  group: "nav" | "patient";
  title: string;
  subtitle?: string;
  Icon?: React.ComponentType<{ className?: string }>;
  action: () => void;
}

function matchStr(haystack: string | undefined | null, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();
  const [, setLocation] = useLocation();
  const { user } = useAuth();

  const { data: patientsData } = useListPatients(
    { limit: 100 },
    { query: { queryKey: getListPatientsQueryKey({ limit: 100 }), enabled: open, staleTime: 60_000 } }
  );
  const patients = patientsData?.patients ?? [];

  // Nav items filtered by role
  const visibleNav = useMemo<NavItem[]>(() => {
    return navItems.filter(item => !item.roles || (user && item.roles.includes(user.role)));
  }, [user]);

  const navResults = useMemo<Result[]>(() => {
    const q = query.trim();
    const matches = q
      ? visibleNav.filter(item => matchStr(t(item.labelKey as any), q) || matchStr(item.href, q))
      : visibleNav.slice(0, 8);
    return matches.map(item => ({
      id: `nav-${item.key}`,
      group: "nav" as const,
      title: t(item.labelKey as any),
      subtitle: item.href,
      Icon: item.icon,
      action: () => { setLocation(item.href); onClose(); },
    }));
  }, [query, visibleNav, t, setLocation, onClose]);

  const patientResults = useMemo<Result[]>(() => {
    const q = query.trim();
    if (!q || q.length < 2) return [];
    return patients
      .filter(p => matchStr(p.fullName, q) || matchStr(p.mrn, q) || matchStr(p.phone, q))
      .slice(0, 6)
      .map(p => ({
        id: `patient-${p.id}`,
        group: "patient" as const,
        title: p.fullName ?? "",
        subtitle: p.mrn ? `MRN ${p.mrn}` : undefined,
        action: () => { setLocation(`/patients/${p.id}`); onClose(); },
      }));
  }, [query, patients, setLocation, onClose]);

  const allResults = [...navResults, ...patientResults];

  useEffect(() => { setActiveIdx(0); }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, allResults.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && allResults[activeIdx]) { e.preventDefault(); allResults[activeIdx].action(); }
    if (e.key === "Escape") onClose();
  };

  if (!open) return null;

  const showPatientSection = patientResults.length > 0;
  const showNavHeader = query.length >= 2 && showPatientSection;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ paddingTop: "18vh", background: "rgba(0,0,0,0.25)", backdropFilter: "blur(2px)" }}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card w-full mx-4"
        style={{ maxWidth: 560, boxShadow: "var(--shadow-lg)" }}
        role="dialog"
        aria-modal="true"
        aria-label={t("commandPalette") || "Command palette"}
        onKeyDown={handleKey}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 border-b border-[var(--line)]" style={{ height: 52 }}>
          <Search className="w-4 h-4 text-[var(--ink-muted)] flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent outline-none text-[14px] text-[var(--ink)] placeholder:text-[var(--ink-faint)]"
            placeholder={t("commandPalettePlaceholder") || "Search pages, patients, actions…"}
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        {/* Results */}
        <div className="overflow-y-auto" style={{ maxHeight: 380 }} role="listbox">
          {allResults.length === 0 && (
            <div className="flex items-center justify-center py-10 text-[13px] text-[var(--ink-muted)]">
              {t("noResults") || "No results"}
            </div>
          )}

          {navResults.length > 0 && (
            <div>
              {showNavHeader && (
                <div className="nav-section-title px-4 pt-2">{t("navigation") || "Navigation"}</div>
              )}
              {navResults.map((r, i) => (
                <ResultRow
                  key={r.id}
                  result={r}
                  active={i === activeIdx}
                  onHover={() => setActiveIdx(i)}
                />
              ))}
            </div>
          )}

          {showPatientSection && (
            <div>
              <div className="nav-section-title px-4 pt-2">{t("patients")}</div>
              {patientResults.map((r, i) => {
                const idx = navResults.length + i;
                return (
                  <ResultRow
                    key={r.id}
                    result={r}
                    active={idx === activeIdx}
                    onHover={() => setActiveIdx(idx)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center gap-3 px-4 border-t border-[var(--line)] text-[11px] text-[var(--ink-faint)]"
          style={{ height: 36 }}
        >
          <span><kbd className="kbd" style={{ fontSize: 9 }}>↑↓</kbd> navigate</span>
          <span><kbd className="kbd" style={{ fontSize: 9 }}>↵</kbd> open</span>
          <span><kbd className="kbd" style={{ fontSize: 9 }}>Esc</kbd> close</span>
        </div>
      </div>
    </div>,
    document.body
  );
}

function ResultRow({
  result,
  active,
  onHover,
}: {
  result: Result;
  active: boolean;
  onHover: () => void;
}) {
  const { Icon } = result;
  const initials = result.group === "patient"
    ? result.title.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()
    : null;

  return (
    <div
      role="option"
      aria-selected={active}
      className={cn(
        "flex items-center gap-3 px-4 cursor-pointer transition-colors text-[13px]",
        active ? "bg-[var(--teal-50)] text-[var(--teal-700)]" : "hover:bg-[var(--surface-2)]"
      )}
      style={{ height: 44 }}
      onMouseEnter={onHover}
      onMouseDown={e => { e.preventDefault(); result.action(); }}
    >
      {Icon && (
        <Icon className={cn("w-4 h-4 flex-shrink-0", active ? "text-[var(--teal-600)]" : "text-[var(--ink-muted)]")} />
      )}
      {!Icon && initials && (
        <span className="avatar avatar-sm avatar-teal flex-shrink-0">{initials}</span>
      )}
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{result.title}</div>
        {result.subtitle && (
          <div className={cn("truncate text-[11px]", active ? "text-[var(--teal-500)]" : "text-[var(--ink-muted)]")}>
            {result.subtitle}
          </div>
        )}
      </div>
      {result.group === "nav" && (
        <ChevronRight className={cn("w-3.5 h-3.5 flex-shrink-0", active ? "opacity-60" : "opacity-25")} />
      )}
    </div>
  );
}
