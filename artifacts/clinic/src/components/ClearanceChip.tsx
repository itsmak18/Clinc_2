import { useI18n } from "@/hooks/i18n";
import { formatCurrency } from "@/lib/api";
import { CheckCircle2, Lock, ShieldAlert, TimerOff } from "lucide-react";

/**
 * Financial clearance chip for clinical orders (ADR-011 + clearance-visibility
 * plan). Shows the department user the payment state of THE REQUEST THEY
 * RECEIVED and its own price — never invoice totals, basket balance, or other
 * departments' lines (plan D1, Mike's constraint 2026-07-11):
 *
 * - cleared + charge  → green "Paid — {amount}": the go-signal, process it.
 * - pending           → amber "Awaiting payment — {amount}": send the patient
 *                       to the front desk to pay.
 * - overridden        → blue "Emergency override — {amount}": process now,
 *                       money still owed (tracked on reconciliation).
 * - expired           → rose "Payment expired".
 * - no charge (pre-gate row) → renders nothing, so flag-OFF UI is unchanged.
 *
 * Deliberately NOT StatusBadge: this chip needs an icon slot, i18n'd
 * non-status labels, and the render-nothing-when-pre-gate contract, none of
 * which StatusBadge's TONES/SHAPES model supports.
 */
export default function ClearanceChip({
  status,
  charge,
}: {
  status?: string | null;
  charge?: { amountCents: number } | null;
}) {
  const { t } = useI18n();
  const amount = charge ? `$${formatCurrency(charge.amountCents / 100)}` : null;
  if (!status) return null;
  if (status === "cleared") {
    // Positive confirmation only for gate-managed rows (charge present);
    // grandfathered/flag-OFF rows stay visually quiet.
    if (!amount) return null;
    return (
      <span className="badge badge-sage text-[10px] gap-0.5">
        <CheckCircle2 className="w-2.5 h-2.5" /> {t("paidAmount")} — {amount}
      </span>
    );
  }
  if (status === "pending") {
    return (
      <span className="badge badge-amber text-[10px] gap-0.5" title={t("collectAtFrontDesk")}>
        <Lock className="w-2.5 h-2.5" /> {t("awaitingPayment")}
        {amount ? <> — {amount}</> : null}
      </span>
    );
  }
  if (status === "overridden") {
    return (
      <span className="badge badge-blue text-[10px] gap-0.5" title={t("overrideAmountOwed")}>
        <ShieldAlert className="w-2.5 h-2.5" /> {t("clearanceOverridden")}
        {amount ? <> — {amount}</> : null}
      </span>
    );
  }
  if (status === "expired") {
    return (
      <span className="badge badge-rose text-[10px] gap-0.5">
        <TimerOff className="w-2.5 h-2.5" /> {t("clearanceExpired")}
      </span>
    );
  }
  return null;
}