import { useLocation } from "wouter";
import { ShieldOff } from "lucide-react";
import { useI18n } from "@/hooks/i18n";

export default function AccessDenied() {
  const [, setLocation] = useLocation();
  const { t, isRtl } = useI18n();

  return (
    <div
      className="flex flex-col items-center justify-center h-full py-24 text-center px-6"
      dir={isRtl ? "rtl" : "ltr"}
      data-testid="page-access-denied"
    >
      <div className="w-14 h-14 rounded-full bg-[var(--rose-500)]/10 flex items-center justify-center mb-4">
        <ShieldOff className="w-7 h-7 text-[var(--rose-500)]" />
      </div>
      <h2 className="text-lg font-semibold text-[var(--ink)] mb-1">{t("accessDenied")}</h2>
      <p className="text-sm text-[var(--ink-muted)] max-w-xs mb-6">
        {t("accessDeniedDesc")}
      </p>
      <button className="btn btn-primary btn-sm" onClick={() => setLocation("/dashboard")} data-testid="button-go-dashboard">
        {t("goToDashboard")}
      </button>
    </div>
  );
}
