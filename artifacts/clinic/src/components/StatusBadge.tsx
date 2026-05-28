/** Shape-coded status pill — colour + CSS-mask shape so status is never hue-only (a11y). */

import { cn } from "@/lib/utils";

type Tone = "teal" | "sage" | "sand" | "rose" | "amber" | "blue";
type Shape = "circle" | "square" | "diamond" | "triangle" | "bar" | "check" | "cross" | "clock";

const TONES: Record<string, Tone> = {
  /* Appointment flow (MediCore state machine) */
  scheduled:            "sand",
  checked_in:           "blue",
  in_triage:            "amber",
  ready_for_doctor:     "teal",
  in_consultation:      "teal",
  awaiting_diagnostics: "blue",
  pending_payment:      "sand",
  completed:            "sage",
  cancelled:            "rose",
  no_show:              "rose",
  /* Pharmacy */
  queued:       "sand",
  dispensing:   "amber",
  ready:        "teal",
  dispensed:    "sage",
  /* Triage priority */
  routine:  "sage",
  stat:     "rose",
  urgent:   "rose",
  critical: "rose",
  normal:   "sage",
  /* Lab */
  awaiting_collection: "sand",
  collected:           "amber",
  in_progress:         "blue",
  resulted:            "teal",
  /* Imaging */
  requested: "sand",
  uploaded:  "teal",
  reviewed:  "sage",
  reading:   "blue",
  /* Billing */
  paid:     "sage",
  partial:  "sand",
  unpaid:   "amber",
  overdue:  "rose",
  pending:  "sand",
  /* Operations */
  /* Generic */
  info:   "sage",
  warn:   "sand",
  high:   "rose",
  online: "sage",
  busy:   "sand",
  away:   "amber",
  /* User presence */
  waiting: "amber",
  in_room: "teal",
};

const SHAPES: Record<string, Shape> = {
  scheduled:            "circle",
  checked_in:           "check",
  in_triage:            "bar",
  ready_for_doctor:     "triangle",
  in_consultation:      "square",
  awaiting_diagnostics: "clock",
  pending_payment:      "diamond",
  completed:            "check",
  cancelled:            "cross",
  no_show:              "cross",
  queued:               "circle",
  dispensing:           "bar",
  ready:                "triangle",
  dispensed:            "check",
  routine:              "circle",
  stat:                 "triangle",
  urgent:               "triangle",
  critical:             "triangle",
  normal:               "circle",
  awaiting_collection:  "circle",
  collected:            "square",
  in_progress:          "bar",
  resulted:             "check",
  requested:            "circle",
  uploaded:             "square",
  reviewed:             "check",
  reading:              "bar",
  paid:                 "check",
  partial:              "bar",
  unpaid:               "diamond",
  overdue:              "cross",
  pending:              "diamond",
  info:                 "circle",
  warn:                 "diamond",
  high:                 "triangle",
  online:               "circle",
  busy:                 "square",
  away:                 "diamond",
  waiting:              "clock",
  in_room:              "square",
};

interface Props {
  status: string;
  label?: string;
  className?: string;
}

export default function StatusBadge({ status, label, className }: Props) {
  const tone: Tone = TONES[status] ?? "sage";
  const shape: Shape = SHAPES[status] ?? "circle";
  const text = label ?? status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

  return (
    <span
      className={cn(
        "badge",
        `badge-${tone}`,
        "badge-icon",
        `badge-shape-${shape}`,
        className,
      )}
      role="status"
      aria-label={text}
      data-testid={`status-${status}`}
    >
      {text}
    </span>
  );
}
