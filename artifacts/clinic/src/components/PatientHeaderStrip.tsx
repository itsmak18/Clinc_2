import { cn } from "@/lib/utils";
import VitalChip from "./VitalChip";
import { AlertTriangle } from "lucide-react";

interface Vitals {
  bp?: string;
  hr?: number;
  temp?: number;
  spo2?: number;
  rr?: number;
  glucose?: number;
}

interface PatientHeaderStripProps {
  name: string;
  mrn?: string;
  dob?: string;
  gender?: string;
  allergies?: string[];
  vitals?: Vitals;
  className?: string;
}

function age(dob?: string): string {
  if (!dob) return "";
  const years = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
  return `${years} y`;
}

export default function PatientHeaderStrip({ name, mrn, dob, gender, allergies, vitals, className }: PatientHeaderStripProps) {
  return (
    <div className={cn("flex flex-col gap-3 p-4 border-b border-[var(--line)]", className)}>
      {/* Identity row */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="avatar avatar-lg avatar-teal">
          {name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
        </span>
        <div>
          <h2 className="h3">{name}</h2>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {mrn && <span className="eyebrow text-[var(--ink-muted)]">MRN {mrn}</span>}
            {dob && <span className="text-[12px] text-[var(--ink-muted)]">{age(dob)} · {new Date(dob).toLocaleDateString()}</span>}
            {gender && <span className="text-[12px] text-[var(--ink-muted)] capitalize">{gender}</span>}
          </div>
        </div>
        {allergies && allergies.length > 0 && (
          <div className="flex items-center gap-1.5 ms-auto flex-wrap">
            <AlertTriangle className="w-3.5 h-3.5 text-[var(--rose-500)]" aria-hidden="true" />
            {allergies.map(a => (
              <span key={a} className="badge badge-rose text-[11px]">{a}</span>
            ))}
          </div>
        )}
      </div>

      {/* Vitals row */}
      {vitals && (
        <div className="flex items-center gap-2 flex-wrap" role="list" aria-label="Current vitals">
          {vitals.bp     !== undefined && <div role="listitem"><VitalChip vitalKey="bp"      value={vitals.bp} /></div>}
          {vitals.hr     !== undefined && <div role="listitem"><VitalChip vitalKey="hr"      value={vitals.hr} /></div>}
          {vitals.temp   !== undefined && <div role="listitem"><VitalChip vitalKey="temp"    value={vitals.temp} /></div>}
          {vitals.spo2   !== undefined && <div role="listitem"><VitalChip vitalKey="spo2"    value={vitals.spo2} /></div>}
          {vitals.rr     !== undefined && <div role="listitem"><VitalChip vitalKey="rr"      value={vitals.rr} /></div>}
          {vitals.glucose !== undefined && <div role="listitem"><VitalChip vitalKey="glucose" value={vitals.glucose} /></div>}
        </div>
      )}
    </div>
  );
}
