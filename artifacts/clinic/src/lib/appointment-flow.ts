/**
 * appointment-flow.ts
 *
 * Patient-flow projection: maps the 10-state appointment machine onto the
 * 6-column operator view the clinic actually thinks in:
 *
 *   Booked | Waiting | With Nurse | Waiting for Doctor | With Doctor | Checkout
 *
 * The DB enum (`appointment_status`) remains the system of record. This module
 * is PRESENTATION ONLY — it never changes a status, it only relabels/groups one.
 * `awaiting_diagnostics` folds under "With Doctor"; `pending_payment`/`completed`
 * fold under "Checkout"; terminal `cancelled`/`no_show` are filter chips, not
 * columns. See docs/PATIENT_FLOW_6STATE_UX_PLAN.md (Phase 1).
 */

export type AppointmentStatus =
  | "scheduled"
  | "checked_in"
  | "in_triage"
  | "ready_for_doctor"
  | "in_consultation"
  | "awaiting_diagnostics"
  | "pending_payment"
  | "completed"
  | "cancelled"
  | "no_show";

/**
 * i18n key holding the friendly flow label for each status.
 * Terminal states reuse the existing shared keys (label unchanged), so this map
 * never forces a relabel of `cancelled`/`no_show` elsewhere in the app.
 */
export const FLOW_LABEL_KEY: Record<string, string> = {
  scheduled: "flowBooked",
  checked_in: "flowWaiting",
  in_triage: "flowWithNurse",
  ready_for_doctor: "flowWaitingForDoctor",
  in_consultation: "flowWithDoctor",
  awaiting_diagnostics: "flowAwaitingResults",
  pending_payment: "flowCheckout",
  completed: "flowDone",
  cancelled: "cancelled",
  no_show: "no_show",
};

export interface FlowColumn {
  /** stable column id */
  key: string;
  /** i18n key for the column header (the column's primary flow label) */
  labelKey: string;
  /** statuses that fall into this column, in flow order */
  statuses: AppointmentStatus[];
}

/** The 6 visible board columns. */
export const FLOW_COLUMNS: FlowColumn[] = [
  { key: "booked", labelKey: "flowBooked", statuses: ["scheduled"] },
  { key: "waiting", labelKey: "flowWaiting", statuses: ["checked_in"] },
  { key: "nurse", labelKey: "flowWithNurse", statuses: ["in_triage"] },
  { key: "for_doc", labelKey: "flowWaitingForDoctor", statuses: ["ready_for_doctor"] },
  { key: "with_doc", labelKey: "flowWithDoctor", statuses: ["in_consultation", "awaiting_diagnostics"] },
  { key: "checkout", labelKey: "flowCheckout", statuses: ["pending_payment", "completed"] },
];

/** Terminal states — shown as filter chips, never as a flow column. */
export const FLOW_TERMINAL: AppointmentStatus[] = ["cancelled", "no_show"];

/** Column key for a status, or `null` for terminal/unknown statuses. */
export function columnForStatus(status: string): string | null {
  for (const col of FLOW_COLUMNS) {
    if ((col.statuses as string[]).includes(status)) return col.key;
  }
  return null;
}

/**
 * Friendly flow label for a status, resolved through the i18n `t` function.
 * Falls back to `t(status)` for anything not in the flow map.
 */
export function flowLabel(t: (key: string) => string, status: string): string {
  return t(FLOW_LABEL_KEY[status] ?? status);
}
