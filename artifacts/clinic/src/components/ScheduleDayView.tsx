import { useMemo, useState } from "react";
import {
  useListAppointments, getListAppointmentsQueryKey,
  useListUsers, getListUsersQueryKey,
} from "@workspace/api-client-react";
import { useI18n } from "@/hooks/i18n";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { calcAge, formatDate } from "@/lib/api";
import { flowLabel } from "@/lib/appointment-flow";
import { cn } from "@/lib/utils";
import { DoctorAvatar, doctorColor } from "@/components/DoctorAvatar";
import { ChevronLeft, ChevronRight, ChevronDown, Users, AlertTriangle, CalendarClock } from "lucide-react";

// ── status → visible Bayan badge ──────────────────────────────────────────────
const STATUS_BADGE: Record<string, string> = {
  scheduled: "badge-sand",
  checked_in: "badge-amber",
  in_triage: "badge-amber",
  ready_for_doctor: "badge-blue",
  in_consultation: "badge-teal",
  awaiting_diagnostics: "badge-blue",
  pending_payment: "badge-sand",
  completed: "badge-sage",
  cancelled: "badge-rose",
  no_show: "",
};

const pad = (n: number) => String(n).padStart(2, "0");
const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s: string, n: number) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return toDateStr(d); };
const fmtTime = (v: string | Date) =>
  new Date(v).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const hourLabel = (h: number) => (h === 0 ? "12:00 AM" : h === 12 ? "12:00 PM" : h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`);

function StatCard({ label, value, tint }: { label: string; value: number; tint: string }) {
  return (
    <div className="rounded-lg p-2.5" style={{ background: `var(--${tint}-50)` }}>
      <div className="text-xl font-semibold leading-none" style={{ color: `var(--${tint}-500)` }}>{value}</div>
      <div className="text-[11px] text-[var(--ink-muted)] mt-1">{label}</div>
    </div>
  );
}

export default function ScheduleDayView() {
  const { t } = useI18n();
  const [selectedDate, setSelectedDate] = useState(toDateStr(new Date()));
  const [doctorFilter, setDoctorFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const params = { date: selectedDate, limit: 100 } as const;
  const { data: resp, isLoading } = useListAppointments(params, {
    query: { queryKey: getListAppointmentsQueryKey(params), refetchInterval: 30000 },
  });
  const appts = resp?.data ?? [];

  const { data: doctors } = useListUsers(
    { role: "doctor" as any },
    { query: { queryKey: getListUsersQueryKey({ role: "doctor" as any }) } },
  );
  const doctorCount = doctors?.length ?? 0;

  const filtered = doctorFilter === "all" ? appts : appts.filter(a => String(a.doctorId) === doctorFilter);

  // Day overview is always the full day (sidebar); the timeline obeys the doctor filter.
  const buckets = useMemo(() => {
    const b = { confirmed: 0, inProgress: 0, completed: 0, pending: 0, cancelled: 0, emergency: 0 };
    for (const a of appts) {
      if ((a as any).triagePriority === "critical") b.emergency++;
      switch (a.status) {
        case "scheduled": b.confirmed++; break;
        case "checked_in": b.pending++; break;
        case "in_triage": case "ready_for_doctor": case "in_consultation":
        case "awaiting_diagnostics": case "pending_payment": b.inProgress++; break;
        case "completed": b.completed++; break;
        case "cancelled": case "no_show": b.cancelled++; break;
      }
    }
    return b;
  }, [appts]);

  const doctorLoad = useMemo(() => {
    const m = new Map<number, { id: number; name: string; count: number }>();
    for (const a of appts) {
      const id = a.doctorId;
      const e = m.get(id) ?? { id, name: a.doctor?.fullName ?? `#${id}`, count: 0 };
      e.count++; m.set(id, e);
    }
    return [...m.values()].sort((x, y) => y.count - x.count).slice(0, 7);
  }, [appts]);
  const maxLoad = doctorLoad[0]?.count ?? 1;

  const upcoming = useMemo(() => {
    const now = Date.now();
    return [...appts]
      .filter(a => ["scheduled", "checked_in"].includes(a.status) && new Date(a.scheduledAt).getTime() >= now)
      .sort((x, y) => new Date(x.scheduledAt).getTime() - new Date(y.scheduledAt).getTime())
      .slice(0, 12);
  }, [appts]);

  const byHour = useMemo(() => {
    const m = new Map<number, typeof filtered>();
    for (const a of [...filtered].sort((x, y) => new Date(x.scheduledAt).getTime() - new Date(y.scheduledAt).getTime())) {
      const h = new Date(a.scheduledAt).getHours();
      const arr = m.get(h) ?? [];
      arr.push(a); m.set(h, arr);
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0]);
  }, [filtered]);

  const dateLabel = new Date(selectedDate + "T00:00:00").toLocaleDateString([], {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
  const isToday = selectedDate === toDateStr(new Date());

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* ── Main column ─────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {/* Header: date nav + doctor filter + summary */}
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <button className="btn btn-outline btn-icon btn-sm" onClick={() => setSelectedDate(d => addDays(d, -1))} aria-label={t("previous")}>
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="px-2">
            <div className="text-sm font-semibold text-[var(--ink)] leading-tight">{dateLabel}</div>
          </div>
          <button className="btn btn-outline btn-icon btn-sm" onClick={() => setSelectedDate(d => addDays(d, 1))} aria-label={t("next")}>
            <ChevronRight className="w-4 h-4" />
          </button>
          {!isToday && (
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDate(toDateStr(new Date()))}>{t("today")}</button>
          )}
          <Select value={doctorFilter} onValueChange={setDoctorFilter}>
            <SelectTrigger className="h-8 text-sm w-52" data-testid="select-day-doctor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("allDoctors")} ({doctorCount})</SelectItem>
              {doctors?.map(d => <SelectItem key={d.id} value={String(d.id)}>{d.fullName}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="ms-auto text-xs text-[var(--ink-muted)]">
            {doctorCount} {t("doctors")} · {appts.length} {t("appointmentsToday")}
          </div>
        </div>

        {/* Timeline */}
        {isLoading ? (
          <div className="card card-pad text-sm text-[var(--ink-muted)]">{t("loading")}</div>
        ) : byHour.length === 0 ? (
          <div className="card flex items-center justify-center py-12 text-sm text-[var(--ink-muted)] border-dashed">
            {t("noAppointmentsForDay")}
          </div>
        ) : (
          <div className="space-y-4">
            {byHour.map(([hour, list]) => (
              <div key={hour}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-semibold text-[var(--ink-soft)]">{hourLabel(hour)}</span>
                  <span className="h-px flex-1 bg-[var(--line)]" />
                  <span className="text-[11px] text-[var(--ink-muted)]">{list.length} {t("apptsShort")}</span>
                </div>
                <div className="space-y-2">
                  {list.map(a => {
                    const isEmergency = (a as any).triagePriority === "critical";
                    const expanded = expandedId === a.id;
                    const dob = (a.patient as any)?.dateOfBirth;
                    const insurance = (a.patient as any)?.insuranceProvider;
                    const source = (a as any).bookingSource as string | undefined;
                    return (
                      <div
                        key={a.id}
                        className="card overflow-hidden"
                        style={{ borderInlineStartWidth: 3, borderInlineStartColor: doctorColor(a.doctorId) }}
                      >
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setExpandedId(e => (e === a.id ? null : a.id))}
                          className="w-full flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5 text-start transition-colors hover:bg-[var(--surface-2)]"
                        >
                          <div className="w-14 flex-shrink-0">
                            <div className="text-[13px] font-semibold text-[var(--ink)]">{fmtTime(a.scheduledAt)}</div>
                          </div>
                          <div className="flex items-center gap-2 min-w-[150px]">
                            <DoctorAvatar id={a.doctorId} name={a.doctor?.fullName ?? "?"} />
                            <div className="min-w-0">
                              <div className="text-[13px] font-medium text-[var(--ink)] truncate">{a.doctor?.fullName ?? `#${a.doctorId}`}</div>
                              {(a.doctor as any)?.specialty && (
                                <div className="text-[11px] text-[var(--ink-muted)] truncate">{(a.doctor as any).specialty}</div>
                              )}
                            </div>
                          </div>
                          <div className="min-w-[140px]">
                            <div className="text-[13px] text-[var(--ink)] truncate">{a.patient?.fullName ?? `#${a.patientId}`}</div>
                            <div className="text-[11px] text-[var(--ink-muted)]">
                              <span className="font-mono">{a.patient?.mrn ?? "—"}</span>
                              {dob && <span> · {t("age")} {calcAge(dob)}</span>}
                            </div>
                          </div>
                          <div className="flex-1 min-w-[90px] text-[13px] text-[var(--ink-soft)] truncate">{a.reason}</div>
                          {isEmergency && (
                            <span className="badge badge-rose text-[11px] gap-1"><AlertTriangle className="w-3 h-3" />{t("emergency")}</span>
                          )}
                          <span className={cn("badge text-[11px]", STATUS_BADGE[a.status])}>{flowLabel(t, a.status)}</span>
                          <ChevronDown className={cn("w-4 h-4 text-[var(--ink-muted)] flex-shrink-0 transition-transform", expanded && "rotate-180")} />
                        </button>

                        {expanded && (
                          <div className="border-t border-[var(--line)] bg-[var(--surface-2)] px-3 py-3 grid grid-cols-1 sm:grid-cols-3 gap-4 text-[12px]">
                            <div>
                              <div className="font-semibold text-[var(--ink-soft)] mb-1.5">{t("patientInfo")}</div>
                              <div className="text-[var(--ink)]">{a.patient?.fullName ?? "—"}</div>
                              {dob && <div className="text-[var(--ink-muted)] mt-0.5">{t("dateOfBirth")}: {formatDate(dob)}</div>}
                              <div className="text-[var(--ink-muted)] mt-0.5">{t("phone")}: {(a.patient as any)?.phone ?? "—"}</div>
                              <div className="text-[var(--ink-muted)] mt-0.5"><span className="font-mono">{t("mrn")}: {a.patient?.mrn ?? "—"}</span></div>
                              {insurance && <div className="text-[var(--ink-muted)] mt-0.5">{t("insurance")}: {insurance}</div>}
                            </div>
                            <div>
                              <div className="font-semibold text-[var(--ink-soft)] mb-1.5">{t("appointmentInfo")}</div>
                              <div className="text-[var(--ink)]">{a.reason}</div>
                              <div className="text-[var(--ink-muted)] mt-0.5">{fmtTime(a.scheduledAt)}</div>
                              <div className="text-[var(--ink-muted)] mt-0.5">{t("status")}: {flowLabel(t, a.status)}</div>
                              {source && <div className="text-[var(--ink-muted)] mt-0.5">{t("bookingSource")}: {source.replace(/_/g, " ")}</div>}
                            </div>
                            <div>
                              <div className="font-semibold text-[var(--ink-soft)] mb-1.5">{t("notes")}</div>
                              <div className="text-[var(--ink)] whitespace-pre-wrap break-words">{a.notes || "—"}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-full lg:w-80 flex-shrink-0">
        <div className="card card-pad">
          <Tabs defaultValue="overview">
            <TabsList className="grid grid-cols-2 mb-3">
              <TabsTrigger value="overview">{t("overview")}</TabsTrigger>
              <TabsTrigger value="upcoming">{t("upcoming")}</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div>
                <div className="text-xs text-[var(--ink-muted)] mb-2">{t("today")} · {appts.length} {t("total")}</div>
                <div className="grid grid-cols-2 gap-2">
                  <StatCard label={t("confirmed")}  value={buckets.confirmed}  tint="blue" />
                  <StatCard label={t("inProgress")}  value={buckets.inProgress}  tint="teal" />
                  <StatCard label={t("completed")}   value={buckets.completed}   tint="sage" />
                  <StatCard label={t("pending")}     value={buckets.pending}     tint="amber" />
                  <StatCard label={t("cancelled")}   value={buckets.cancelled}   tint="sand" />
                  <StatCard label={t("emergency")}   value={buckets.emergency}   tint="rose" />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-[var(--ink-soft)]">{t("doctorLoad")}</span>
                  <Users className="w-3.5 h-3.5 text-[var(--ink-muted)]" />
                </div>
                {doctorLoad.length === 0 ? (
                  <div className="text-[11px] text-[var(--ink-faint)]">—</div>
                ) : (
                  <div className="space-y-2">
                    {doctorLoad.map(d => (
                      <div key={d.id} className="flex items-center gap-2">
                        <DoctorAvatar id={d.id} name={d.name} size={24} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-[12px] text-[var(--ink)] truncate">{d.name}</span>
                            <span className="text-[11px] text-[var(--ink-muted)] ms-2">{d.count}</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-[var(--surface-2)] mt-1 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${(d.count / maxLoad) * 100}%`, background: doctorColor(d.id) }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {buckets.emergency > 0 && (
                <div className="flex items-center gap-2 rounded-lg p-2.5 text-[12px]" style={{ background: "var(--rose-50)", color: "var(--rose-500)" }}>
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {buckets.emergency} {t("emergencyAppointmentsToday")}
                </div>
              )}
            </TabsContent>

            <TabsContent value="upcoming">
              {upcoming.length === 0 ? (
                <div className="text-[12px] text-[var(--ink-muted)] py-6 text-center">{t("noUpcoming")}</div>
              ) : (
                <div className="space-y-2">
                  {upcoming.map(a => (
                    <div key={a.id} className="flex items-center gap-2.5">
                      <CalendarClock className="w-3.5 h-3.5 text-[var(--ink-muted)] flex-shrink-0" />
                      <div className="w-14 flex-shrink-0 text-[12px] font-semibold text-[var(--ink)]">{fmtTime(a.scheduledAt)}</div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-[var(--ink)] truncate">{a.patient?.fullName ?? `#${a.patientId}`}</div>
                        <div className="text-[11px] text-[var(--ink-muted)] truncate">{a.doctor?.fullName ?? ""}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </aside>
    </div>
  );
}
