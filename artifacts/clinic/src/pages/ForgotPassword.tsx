import { useState } from "react";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity } from "lucide-react";
import { useI18n } from "@/hooks/i18n";

export default function ForgotPassword() {
  const { t } = useI18n();
  const [username, setUsername] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username) return;
    setBusy(true);
    try {
      await customFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ username }),
      });
    } catch {
      // Same generic shape regardless — we never reveal the outcome.
    } finally {
      setSubmitted(true);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded bg-[var(--teal-600)] flex items-center justify-center">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-[var(--ink)]">Wateen Clinic</span>
        </div>

        <h1 className="text-2xl font-bold text-[var(--ink)] mb-1">{t("forgotPasswordTitle")}</h1>
        <p className="text-sm text-[var(--ink-muted)] mb-6">
          {t("emailResetHint")}
        </p>

        {submitted ? (
          <div
            role="status"
            className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"
            data-testid="forgot-password-confirmation"
          >
            {t("resetLinkSentGeneric")}
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs font-medium">{t("username")}</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                required
                data-testid="input-username"
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={busy}
              data-testid="button-submit"
            >
              {busy ? t("sending") : t("sendResetLink")}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <Link
            to="/login"
            className="text-xs text-[var(--ink-muted)] underline-offset-4 hover:underline"
          >
            {t("backToSignIn")}
          </Link>
        </div>
      </div>
    </div>
  );
}
