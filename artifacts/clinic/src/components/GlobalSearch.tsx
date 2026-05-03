import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { Search, Users, CalendarDays, FileText, X, Loader2 } from "lucide-react";
import { formatDate } from "@/lib/api";

const BASE = import.meta.env.BASE_URL ?? "/";
const apiUrl = (path: string) => `${BASE}api/${path}`.replace(/\/+/g, "/");

interface SearchResults {
  patients: Array<{ id: number; fullName: string; mrn: string; phone?: string | null; dateOfBirth?: string | null }>;
  appointments: Array<{ id: number; reason: string; status: string; scheduledAt: string; patientName?: string | null; patientMrn?: string | null }>;
  records: Array<{ id: number; diagnosis: string; chiefComplaint: string; createdAt: string; patientName?: string | null; patientId: number }>;
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [, navigate] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
    else { setQuery(""); setResults(null); }
  }, [open]);

  const doSearch = useCallback((q: string) => {
    if (q.length < 2) { setResults(null); setLoading(false); return; }
    setLoading(true);
    const token = localStorage.getItem("clinic_token");
    fetch(apiUrl(`search?q=${encodeURIComponent(q)}`), {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(setResults)
      .catch(() => setResults(null))
      .finally(() => setLoading(false));
  }, []);

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 300);
  };

  const go = (href: string) => {
    setOpen(false);
    navigate(href);
  };

  const total = results ? results.patients.length + results.appointments.length + results.records.length : 0;

  return (
    <>
      {/* Trigger button in sidebar */}
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-xs text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        data-testid="button-global-search"
      >
        <Search className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="flex-1 text-start">Search…</span>
        <kbd className="text-[9px] bg-sidebar-accent/60 px-1 py-0.5 rounded border border-sidebar-border/50 font-mono leading-none">⌘K</kbd>
      </button>

      {/* Overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg bg-background rounded-xl shadow-2xl border border-border overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              {loading ? <Loader2 className="w-4 h-4 text-muted-foreground animate-spin flex-shrink-0" /> : <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />}
              <input
                ref={inputRef}
                value={query}
                onChange={handleInput}
                placeholder="Search patients, appointments, records…"
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              {query && (
                <button onClick={() => { setQuery(""); setResults(null); inputRef.current?.focus(); }} className="text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <kbd className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border font-mono">Esc</kbd>
            </div>

            {/* Results */}
            <div className="max-h-[60vh] overflow-y-auto">
              {!query && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Type to search patients, appointments, and medical records
                </div>
              )}

              {query.length === 1 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">Keep typing…</div>
              )}

              {results && total === 0 && query.length >= 2 && (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">No results for "<span className="font-medium text-foreground">{query}</span>"</div>
              )}

              {results && results.patients.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 border-b border-border flex items-center gap-1.5">
                    <Users className="w-3 h-3" /> Patients
                  </div>
                  {results.patients.map(p => (
                    <button key={p.id} onClick={() => go(`/patients/${p.id}`)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors text-start border-b border-border/50 last:border-0">
                      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-primary">{p.fullName.charAt(0)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{p.fullName}</div>
                        <div className="text-xs text-muted-foreground">MRN: {p.mrn}{p.dateOfBirth ? ` · ${formatDate(p.dateOfBirth)}` : ""}</div>
                      </div>
                      {p.phone && <span className="text-xs text-muted-foreground">{p.phone}</span>}
                    </button>
                  ))}
                </div>
              )}

              {results && results.appointments.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 border-b border-border flex items-center gap-1.5">
                    <CalendarDays className="w-3 h-3" /> Appointments
                  </div>
                  {results.appointments.map(a => (
                    <button key={a.id} onClick={() => go(`/appointments`)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors text-start border-b border-border/50 last:border-0">
                      <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                        <CalendarDays className="w-3.5 h-3.5 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{a.reason}</div>
                        <div className="text-xs text-muted-foreground">{a.patientName} · {formatDate(a.scheduledAt)}</div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted capitalize flex-shrink-0">{a.status.replace(/_/g, " ")}</span>
                    </button>
                  ))}
                </div>
              )}

              {results && results.records.length > 0 && (
                <div>
                  <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/30 border-b border-border flex items-center gap-1.5">
                    <FileText className="w-3 h-3" /> Medical Records
                  </div>
                  {results.records.map(r => (
                    <button key={r.id} onClick={() => go(`/patients/${r.patientId}`)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-accent transition-colors text-start border-b border-border/50 last:border-0">
                      <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-3.5 h-3.5 text-green-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{r.diagnosis}</div>
                        <div className="text-xs text-muted-foreground">{r.patientName} · {r.chiefComplaint}</div>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{formatDate(r.createdAt)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 py-2 border-t border-border bg-muted/20 flex gap-4 text-[10px] text-muted-foreground">
              <span><kbd className="bg-muted px-1 rounded border border-border font-mono">↵</kbd> select</span>
              <span><kbd className="bg-muted px-1 rounded border border-border font-mono">Esc</kbd> close</span>
              <span><kbd className="bg-muted px-1 rounded border border-border font-mono">⌘K</kbd> toggle</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
