import { cn } from "@/lib/utils";
import Sparkline from "./Sparkline";

type Tone = "teal" | "sage" | "sand" | "rose" | "amber" | "blue";

interface MetricProps {
  label: string;
  value: string | number;
  /** e.g. "+12%" or "-3%" */
  delta?: string;
  deltaDir?: "up" | "down";
  sparkline?: number[];
  tone?: Tone;
  icon?: React.ReactNode;
  className?: string;
}

export default function Metric({ label, value, delta, deltaDir, sparkline, tone = "teal", icon, className }: MetricProps) {
  return (
    <div className={cn("metric fade-in", className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="metric-label">{label}</span>
        {icon && <span className={`text-[var(--${tone}-500)] opacity-70`}>{icon}</span>}
      </div>
      <div className="metric-value">{value}</div>
      {(delta || sparkline) && (
        <div className="flex items-center justify-between gap-2 mt-1">
          {delta && (
            <span className={cn("metric-delta", deltaDir === "down" && "is-down")}>
              {deltaDir === "up" ? "↑" : deltaDir === "down" ? "↓" : ""} {delta}
            </span>
          )}
          {sparkline && <Sparkline data={sparkline} tone={tone} />}
        </div>
      )}
    </div>
  );
}
