import { useI18n } from "@/hooks/i18n";
import { useAuth } from "@/hooks/auth";
import { Settings as SettingsIcon, Shield, Database, Bell, Globe } from "lucide-react";

export default function Settings() {
  const { t } = useI18n();
  const { user } = useAuth();

  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between items-center py-0.5">
      <span className="text-[13px] text-[var(--ink-muted)]">{label}</span>
      <span className="badge text-xs">{value}</span>
    </div>
  );

  const SectionCard = ({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) => (
    <div className="card">
      <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
        <Icon className="w-4 h-4 text-[var(--teal-600)]" />
        <span className="font-semibold text-[14px] text-[var(--ink)]">{title}</span>
      </div>
      <div className="card-pad space-y-2">{children}</div>
    </div>
  );

  return (
    <div className="page">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SectionCard icon={Shield} title={t("settingsSecurity")}>
          <InfoRow label={t("settingsAuthentication")} value={t("settingsAuthMethod")} />
          <InfoRow label={t("settings2FA")} value={t("settingsPlanned")} />
          <InfoRow label={t("settingsSessionTimeout")} value={t("settingsSessionDuration")} />
        </SectionCard>

        <SectionCard icon={Database} title={t("settingsDatabase")}>
          <InfoRow label={t("settingsDbType")} value={t("settingsDbEngine")} />
          <InfoRow label={t("settingsBackupStrategy")} value={t("settingsBackupMode")} />
          <div className="flex justify-between items-center py-0.5">
            <span className="text-[13px] text-[var(--ink-muted)]">{t("settingsSoftDeletes")}</span>
            <span className="badge badge-teal text-xs">{t("settingsEnabled")}</span>
          </div>
        </SectionCard>

        <SectionCard icon={Bell} title={t("settingsNotifications")}>
          <div className="flex justify-between items-center py-0.5">
            <span className="text-[13px] text-[var(--ink-muted)]">{t("settingsPatientArrivalAlerts")}</span>
            <span className="badge badge-teal text-xs">{t("settingsEnabled")}</span>
          </div>
          <div className="flex justify-between items-center py-0.5">
            <span className="text-[13px] text-[var(--ink-muted)]">{t("settingsLabResultAlerts")}</span>
            <span className="badge badge-teal text-xs">{t("settingsEnabled")}</span>
          </div>
          <div className="flex justify-between items-center py-0.5">
            <span className="text-[13px] text-[var(--ink-muted)]">{t("settingsInternalChat")}</span>
            <span className="badge text-xs">{t("settingsExcluded")}</span>
          </div>
        </SectionCard>

        <SectionCard icon={Globe} title={t("settingsLocalization")}>
          <InfoRow label={t("settingsSupportedLanguages")} value={t("settingsLanguages")} />
          <div className="flex justify-between items-center py-0.5">
            <span className="text-[13px] text-[var(--ink-muted)]">{t("settingsRtlSupport")}</span>
            <span className="badge badge-teal text-xs">{t("settingsEnabled")}</span>
          </div>
        </SectionCard>
      </div>

      <div className="card mt-4">
        <div className="card-pad border-b border-[var(--line)] flex items-center gap-2">
          <SettingsIcon className="w-4 h-4 text-[var(--teal-600)]" />
          <span className="font-semibold text-[14px] text-[var(--ink)]">{t("settingsCurrentSession")}</span>
        </div>
        <div className="card-pad grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: t("user"),                value: user?.fullName },
            { label: t("role"),                value: user?.role?.replace(/_/g, " ") },
            { label: t("username"),            value: `@${user?.username}` },
            { label: t("settingsSystemVersion"), value: "v1.0.0" },
          ].map(({ label, value }) => (
            <div key={label}>
              <p className="text-[11px] text-[var(--ink-muted)] mb-0.5">{label}</p>
              <p className="font-medium text-[13px] text-[var(--ink)] capitalize">{value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
