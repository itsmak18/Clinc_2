import { useI18n } from "@/hooks/i18n";
import { Lock, ShieldAlert, TimerOff } from "lucide-react";

/**
 * Financial clearance chip for clinical orders (ADR-011). Renders nothing when
 * the order is cleared (or the column is absent — pre-gate rows), so the happy
 * path stays visually quiet; only blocked/override/expired states surface.
 *
 * Deliberately NOT StatusBadge: this chip needs an icon slot, i18n'd
 * non-status labels, and the render-nothing-when-cleared contract, none of
 * which StatusBadge's TONES/SHAPES model supports.
 */
export default function ClearanceChip({ status }: { status?: string | null }) {
  const { t } = useI18n();
  if (!status || status === "cleared") return null;
  if (status === "pending") {
    return (
      <span className="badge badge-amber text-[10px] gap-0.5" title={t("lockedUntilCleared")}>
        <Lock className="w-2.5 h-2.5" /> {t("awaitingPayment")}
      </span>
    );
  }
  if (status === "overridden") {
    return (
      <span className="badge badge-blue text-[10px] gap-0.5">
        <ShieldAlert className="w-2.5 h-2.5" /> {t("clearanceOverridden")}
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
