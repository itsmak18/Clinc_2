import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type Stage = { value: string; label: string };

/**
 * Compact horizontal pipeline indicator for a linear workflow
 * (e.g. imaging: requested → in_progress → completed). Read-only; the actual
 * transition control lives next to it. Stages before/at `current` are filled.
 */
export default function StatusStepper({ stages, current }: { stages: Stage[]; current: string }) {
  const currentIdx = Math.max(0, stages.findIndex(s => s.value === current));
  return (
    <div className="flex items-center gap-1" role="list" aria-label="workflow status">
      {stages.map((s, i) => {
        const done = i < currentIdx;
        const active = i === currentIdx;
        return (
          <div key={s.value} className="flex items-center gap-1" role="listitem">
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border",
                active && "bg-[var(--teal-600)] text-white border-[var(--teal-600)]",
                done && "bg-[var(--teal-50)] text-[var(--teal-600)] border-[var(--teal-600)]",
                !active && !done && "bg-[var(--surface)] text-[var(--ink-faint)] border-[var(--line)]",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="w-3 h-3" /> : <span className="inline-flex w-4 justify-center">{i + 1}</span>}
              {s.label}
            </span>
            {i < stages.length - 1 && (
              <span className={cn("h-px w-3", i < currentIdx ? "bg-[var(--teal-600)]" : "bg-[var(--line)]")} />
            )}
          </div>
        );
      })}
    </div>
  );
}
