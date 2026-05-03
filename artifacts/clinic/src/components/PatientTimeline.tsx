import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/api";
import StatusBadge from "@/components/StatusBadge";
import { CalendarDays, FileText, FlaskConical, Scan, Pill, Receipt, Activity } from "lucide-react";

type Appt = { scheduledAt: string | Date; reason?: string | null; status: string; doctor?: { fullName?: string | null } | null };
type Record_ = { createdAt: string | Date; diagnosis?: string | null; chiefComplaint?: string | null };
type Lab = { createdAt: string | Date; testName?: string | null; status: string; results?: string | null };
type XRay = { createdAt: string | Date; bodyPart?: string | null; status: string; report?: string | null };
type Rx = { createdAt: string | Date; medications?: unknown; doctor?: { fullName?: string | null } | null };
type Invoice = { createdAt: string | Date; invoiceNumber?: string | null; total?: number | string | null; status: string };

interface Props {
  appointments?: Appt[];
  records?: Record_[];
  labTests?: Lab[];
  xrays?: XRay[];
  prescriptions?: Rx[];
  invoices?: Invoice[];
}

interface Event {
  date: Date;
  type: "appointment" | "record" | "lab" | "xray" | "prescription" | "invoice";
  label: string;
  sub: string;
  status?: string;
  extra?: string;
}

const TYPE_CONFIG = {
  appointment:  { icon: CalendarDays,  dot: "bg-blue-500",   bg: "bg-blue-50 dark:bg-blue-950/30",   label: "Appointment" },
  record:       { icon: FileText,       dot: "bg-green-500",  bg: "bg-green-50 dark:bg-green-950/30", label: "Medical Record" },
  lab:          { icon: FlaskConical,   dot: "bg-purple-500", bg: "bg-purple-50 dark:bg-purple-950/30", label: "Lab Test" },
  xray:         { icon: Scan,           dot: "bg-indigo-500", bg: "bg-indigo-50 dark:bg-indigo-950/30", label: "X-Ray" },
  prescription: { icon: Pill,           dot: "bg-orange-500", bg: "bg-orange-50 dark:bg-orange-950/30", label: "Prescription" },
  invoice:      { icon: Receipt,        dot: "bg-pink-500",   bg: "bg-pink-50 dark:bg-pink-950/30",  label: "Invoice" },
};

export default function PatientTimeline({ appointments = [], records = [], labTests = [], xrays = [], prescriptions = [], invoices = [] }: Props) {
  const events: Event[] = [
    ...appointments.map(a => ({
      date: new Date(a.scheduledAt),
      type: "appointment" as const,
      label: a.reason || "Appointment",
      sub: a.doctor?.fullName || "",
      status: a.status,
    })),
    ...records.map(r => ({
      date: new Date(r.createdAt),
      type: "record" as const,
      label: r.diagnosis || "Medical Record",
      sub: r.chiefComplaint || "",
    })),
    ...labTests.map(l => ({
      date: new Date(l.createdAt),
      type: "lab" as const,
      label: l.testName || "Lab Test",
      sub: l.results ? "Results available" : "Pending",
      status: l.status,
    })),
    ...xrays.map(x => ({
      date: new Date(x.createdAt),
      type: "xray" as const,
      label: x.bodyPart || "X-Ray",
      sub: x.report ? "Report available" : "Pending report",
      status: x.status,
    })),
    ...prescriptions.map(r => ({
      date: new Date(r.createdAt),
      type: "prescription" as const,
      label: (() => {
        const meds = r.medications as Array<{ name: string }> | undefined;
        if (!meds?.length) return "Prescription";
        return meds.slice(0, 2).map(m => m.name).join(", ") + (meds.length > 2 ? ` +${meds.length - 2}` : "");
      })(),
      sub: r.doctor?.fullName || "",
    })),
    ...invoices.map(i => ({
      date: new Date(i.createdAt),
      type: "invoice" as const,
      label: i.invoiceNumber || "Invoice",
      sub: `$${Number(i.total ?? 0).toFixed(2)}`,
      status: i.status,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  if (!events.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
        <Activity className="w-8 h-8 opacity-30" />
        <p className="text-sm">No clinical history found</p>
      </div>
    );
  }

  let lastYear = "";

  return (
    <div className="relative">
      <div className="absolute start-[19px] top-0 bottom-0 w-px bg-border" />
      <div className="space-y-1">
        {events.map((ev, i) => {
          const cfg = TYPE_CONFIG[ev.type];
          const Icon = cfg.icon;
          const year = ev.date.getFullYear().toString();
          const showYear = year !== lastYear;
          lastYear = year;
          return (
            <div key={i}>
              {showYear && (
                <div className="relative flex items-center gap-3 py-2 ps-12">
                  <span className="text-xs font-bold text-muted-foreground uppercase tracking-widest">{year}</span>
                </div>
              )}
              <div className="relative flex items-start gap-3 py-1.5">
                <div className={cn("relative z-10 flex items-center justify-center w-10 h-10 rounded-full flex-shrink-0 border-2 border-background", cfg.bg)}>
                  <Icon className="w-4 h-4 text-foreground/70" />
                </div>
                <div className={cn("flex-1 rounded-lg border border-border px-3 py-2 text-sm", cfg.bg)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{cfg.label}</span>
                        {ev.status && <StatusBadge status={ev.status} className="text-[10px] px-1.5 py-0" />}
                      </div>
                      <p className="font-medium text-foreground leading-tight mt-0.5">{ev.label}</p>
                      {ev.sub && <p className="text-xs text-muted-foreground mt-0.5">{ev.sub}</p>}
                    </div>
                    <span className="text-[11px] text-muted-foreground flex-shrink-0 whitespace-nowrap">{formatDateTime(ev.date)}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
