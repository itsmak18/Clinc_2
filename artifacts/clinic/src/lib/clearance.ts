/**
 * Clearance gate (ADR-011) — shared frontend predicates, used by the Lab,
 * XRay, Ultrasound and Billing pages. The API enforces every one of these
 * regardless (409/3020, 403); the UI mirrors them so users aren't offered
 * actions the server will reject. Server counterparts:
 * clearanceBlocksProgress + canRoleSettleInvoiceKind in
 * api-server/src/modules/billing — change both sides together.
 */

/** An order awaiting payment (or expired) may not be worked. */
export const isClearanceLocked = (r: { clearanceStatus?: string | null }) =>
  r.clearanceStatus === "pending" || r.clearanceStatus === "expired";

/** Emergency clearance override — clinical roles. */
export const OVERRIDE_ROLES = ["super_admin", "admin", "doctor", "nurse"];

export const canOverrideClearance = (role: string | undefined) =>
  !!role && OVERRIDE_ROLES.includes(role);

/** SoD: front desk settles order baskets only; billing roles settle any kind. */
export const canPayInvoiceKind = (role: string | undefined, kind: string | null | undefined) =>
  role !== "front_desk" || kind === "order_basket";

/**
 * Department queue tabs shared by the Lab / XRay / Ultrasound pages. `value`
 * is passed straight to the `clearanceStatus` list filter (comma list —
 * "ready to process" = cleared OR overridden). Empty = no filter (default:
 * never hide rows by surprise; the workflow guard is the enforcement).
 */
export const CLEARANCE_QUEUE_TABS = [
  { value: "", labelKey: "all" },
  { value: "cleared,overridden", labelKey: "readyToProcess" },
  { value: "pending", labelKey: "awaitingPayment" },
] as const;
