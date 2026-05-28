import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ActivityEvent {
  id: number | string;
  timestamp: string;
  action: string;
  user?: string;
  target?: string;
  severity?: "info" | "warn" | "danger";
}

interface LiveActivityFeedProps {
  events: ActivityEvent[];
  className?: string;
  maxVisible?: number;
}

export default function LiveActivityFeed({ events, className, maxVisible = 8 }: LiveActivityFeedProps) {
  const [visible, setVisible] = useState(events.slice(0, maxVisible));
  const prevEventsRef = useRef(events);

  useEffect(() => {
    const prev = prevEventsRef.current;
    if (events.length !== prev.length || events[0]?.id !== prev[0]?.id) {
      setVisible(events.slice(0, maxVisible));
      prevEventsRef.current = events;
    }
  }, [events, maxVisible]);

  const toneClass: Record<string, string> = {
    info:   "badge-teal",
    warn:   "badge-sand",
    danger: "badge-rose",
  };

  return (
    <div className={cn("flex flex-col gap-0", className)}>
      <div className="flex items-center gap-2 mb-3">
        <span className="live-dot" aria-hidden="true" />
        <span className="eyebrow">Live feed</span>
      </div>
      <ul className="flex flex-col gap-0" role="log" aria-label="Live activity feed" aria-live="polite">
        {visible.map((ev, i) => (
          <li key={ev.id} className={cn("flex items-start gap-2.5 py-2 border-b border-[var(--line-soft)] text-[12.5px]", i === 0 && "list-insert")}>
            <span className="text-[var(--ink-faint)] font-mono text-[10px] mt-0.5 flex-shrink-0 tabular-nums">
              {new Date(ev.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-[var(--ink-soft)]">{ev.action}</span>
              {ev.target && <span className="text-[var(--ink)] font-medium"> · {ev.target}</span>}
              {ev.user && <span className="text-[var(--ink-muted)]"> by {ev.user}</span>}
            </div>
            {ev.severity && ev.severity !== "info" && (
              <span className={cn("badge flex-shrink-0", toneClass[ev.severity] ?? "")} style={{ height: "18px", fontSize: "10px" }}>
                {ev.severity}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
