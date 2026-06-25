import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { ShieldCheck, ShieldAlert, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useI18n } from "@/hooks/i18n";

interface Device {
  deviceId: string;
  firstSeen: string;
  lastSeen: string;
  ipLast: string | null;
  countryLast: string | null;
  trusted: boolean;
  trustSource: string | null;
  trustExpiresAt: string | null;
}

export default function AccountDevices() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await customFetch<{ devices: Device[] }>("/api/account/devices");
      setDevices(res.devices);
    } catch {
      toast({ title: t("devicesLoadFailed"), variant: "destructive" });
    }
  };

  useEffect(() => {
    load();
  }, []);

  const revoke = async (deviceId: string) => {
    if (!confirm(t("confirmRevokeDevice"))) return;
    setBusyId(deviceId);
    try {
      await customFetch(`/api/account/devices/${deviceId}`, { method: "DELETE" });
      toast({ title: t("deviceRevoked") });
      await load();
    } catch {
      toast({ title: t("deviceRevokeFailed"), variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-1 text-[var(--ink)]">{t("yourDevices")}</h1>
      <p className="text-sm text-[var(--ink-muted)] mb-6">
        {t("devicesIntro")}
      </p>

      {devices === null && <div className="text-sm text-[var(--ink-muted)]">{t("loading")}</div>}

      {devices !== null && devices.length === 0 && (
        <div className="text-sm text-[var(--ink-muted)]">
          {t("noActiveDevices")}
        </div>
      )}

      <div className="space-y-3">
        {devices?.map((d) => (
          <div
            key={d.deviceId}
            className="flex items-center justify-between rounded-md border border-[var(--line)] p-3"
            data-testid={`device-row-${d.deviceId}`}
          >
            <div className="flex items-start gap-3">
              {d.trusted ? (
                <ShieldCheck className="w-5 h-5 text-emerald-600 mt-0.5" />
              ) : (
                <ShieldAlert className="w-5 h-5 text-amber-600 mt-0.5" />
              )}
              <div>
                <div className="text-sm font-medium text-[var(--ink)]">
                  {d.trusted ? t("trustedDevice") : t("unverifiedDevice")}
                  {d.trustSource ? ` · ${d.trustSource}` : ""}
                </div>
                <div className="text-xs text-[var(--ink-muted)]">
                  {t("lastUsed")} {new Date(d.lastSeen).toLocaleString()}
                  {d.ipLast ? ` · ${d.ipLast}` : ""}
                  {d.countryLast ? ` · ${d.countryLast}` : ""}
                </div>
                <div className="text-[10px] text-[var(--ink-muted)]/70 font-mono mt-0.5">
                  {d.deviceId}
                </div>
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm gap-1 text-[var(--rose-500)]"
              onClick={() => revoke(d.deviceId)}
              disabled={busyId === d.deviceId}
              data-testid={`button-revoke-${d.deviceId}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t("revoke")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
