import { cn } from "@/lib/utils";

type VitalKey = "bp" | "hr" | "temp" | "spo2" | "rr" | "glucose";

interface Range { low: number; high: number; critLow?: number; critHigh?: number; }

const RANGES: Record<VitalKey, Range> = {
  bp:      { low: 90,  high: 140, critLow: 70,  critHigh: 180 },
  hr:      { low: 60,  high: 100, critLow: 40,  critHigh: 130 },
  temp:    { low: 36.1, high: 37.2, critLow: 35, critHigh: 39  },
  spo2:    { low: 95,  high: 100, critLow: 90  },
  rr:      { low: 12,  high: 20,  critLow: 8,   critHigh: 30  },
  glucose: { low: 4.0, high: 7.0, critLow: 2.8, critHigh: 11  },
};

const LABELS: Record<VitalKey, string> = {
  bp: "BP", hr: "HR", temp: "Temp", spo2: "SpO₂", rr: "RR", glucose: "BG",
};

const UNITS: Record<VitalKey, string> = {
  bp: "mmHg", hr: "bpm", temp: "°C", spo2: "%", rr: "/min", glucose: "mmol/L",
};

function tone(key: VitalKey, value: number): "teal" | "sand" | "rose" {
  const r = RANGES[key];
  if (r.critLow !== undefined && value < r.critLow) return "rose";
  if (r.critHigh !== undefined && value > r.critHigh) return "rose";
  if (value < r.low || value > r.high) return "sand";
  return "teal";
}

interface VitalChipProps {
  vitalKey: VitalKey;
  value: number | string;
  className?: string;
}

export default function VitalChip({ vitalKey, value, className }: VitalChipProps) {
  const numVal = typeof value === "string" ? parseFloat(value) : value;
  const t = isNaN(numVal) ? "teal" : tone(vitalKey, numVal);

  return (
    <span
      className={cn("badge", `badge-${t}`, "flex-col items-start gap-0 h-auto py-1 px-2 rounded-[var(--r-sm)]", className)}
      aria-label={`${LABELS[vitalKey]} ${value} ${UNITS[vitalKey]}`}
    >
      <span className="eyebrow" style={{ fontSize: "9px", letterSpacing: "0.1em" }}>{LABELS[vitalKey]}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", fontWeight: 600 }}>{value}</span>
      <span style={{ fontSize: "9px", opacity: 0.7 }}>{UNITS[vitalKey]}</span>
    </span>
  );
}
