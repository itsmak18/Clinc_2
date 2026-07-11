import { useState } from "react";
import { useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/auth";
import { useI18n } from "@/hooks/i18n";
import { getLandingRoute } from "@/lib/route-access";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, Zap, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const IS_DEV = import.meta.env.MODE !== "production";

// ── Dev-only quick-login chips (never compiled into production builds) ────────
const SEED_ACCOUNTS = IS_DEV ? [
  { username: "superadmin",   password: "admin123",   label: "SuperAdmin" },
  { username: "admin",        password: "admin123",   label: "Admin" },
  { username: "dr_ahmed",     password: "doctor123",  label: "Dr Ahmed" },
  { username: "dr_sara",      password: "doctor123",  label: "Dr Sara" },
  { username: "nurse1",       password: "nurse123",   label: "Nurse" },
  { username: "receptionist", password: "front123",   label: "Front Desk" },
  { username: "xray_tech",    password: "xray123",    label: "X-Ray" },
  { username: "lab_tech",     password: "lab123",     label: "Lab" },
  { username: "compliance",   password: "comply123",  label: "Compliance" },
  { username: "billing_mgr",  password: "billing123", label: "Billing" },
  { username: "pharmacist1",  password: "pharma123",  label: "Pharmacist" },
] : [];

export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const { toast } = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data: any) => {
        // Phase 2 — privileged role on a new device; email verification required.
        if (data?.status === "pending_verification") {
          setPendingMessage(
            data.message ?? "Check your email for a verification link to complete sign-in.",
          );
          return;
        }
        login(data.user);
        if (data?.deviceUnverified) {
          toast({
            title: "Signed in on a new device",
            description: "Some actions are blocked until you verify this device.",
          });
        }
        setLocation(getLandingRoute(data.user.role));
      },
      onError: () => {
        toast({
          title: t("loginFailed"),
          description: t("invalidCredentials"),
          variant: "destructive",
        });
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ data: { username, password } });
  };

  const quickLogin = (u: string, p: string) => {
    loginMutation.mutate({ data: { username: u, password: p } });
  };

  return (
    <div className="login-page">

      {/* ── Left art panel ──────────────────────────────────────────────── */}
      <div className="login-art hidden lg:flex flex-col items-center justify-center">
        {/* Logo */}
        <div className="flex items-center gap-3 relative z-10">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-white"
          >
            <img src="/wateen-mark.png" alt="Wateen Clinic" className="w-7 h-7 object-contain" />
          </div>
          <div>
            <div className="text-[16px] font-bold text-white leading-tight">Wateen</div>
            <div className="text-[11px] leading-tight" style={{ color: "rgba(219,245,235,0.6)" }}>
              Clinic Management System
            </div>
          </div>
        </div>
      </div>

      {/* ── Right form panel ────────────────────────────────────────────── */}
      <div className="relative flex items-center justify-center px-8 py-12 bg-[var(--bg)]">

        {/* Language toggle — lets staff pick Arabic/English before signing in */}
        <button
          type="button"
          onClick={() => setLanguage(language === "en" ? "ar" : "en")}
          className="absolute top-4 end-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--line)] text-[12px] font-medium text-[var(--ink-soft)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] transition-colors"
          aria-label={language === "en" ? t("switchToArabic") : t("switchToEnglish")}
          data-testid="button-toggle-language"
        >
          <Globe className="w-3.5 h-3.5" />
          {t("changeLanguage")}
        </button>

        <div className="w-full" style={{ maxWidth: 360 }}>

          {/* Mobile-only logo */}
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="flex items-center justify-center w-8 h-8 rounded-md dark:bg-white dark:p-1">
              <img src="/wateen-mark.png" alt="Wateen Clinic" className="w-full h-full object-contain" />
            </div>
            <span className="text-[14px] font-bold text-[var(--ink)]">Wateen Clinic</span>
          </div>

          <div className="mb-8">
            <h1 className="text-[26px] font-bold text-[var(--ink)] leading-tight">
              {t("login") || "Sign in"}
            </h1>
            <p className="text-[13px] text-[var(--ink-muted)] mt-1">
              {t("loginSubtitle") || "Staff portal — enter your credentials"}
            </p>
          </div>

          {/* Phase 2 pending-verification notice */}
          {pendingMessage && (
            <div
              role="status"
              className="mb-5 rounded-lg border px-4 py-3 text-[13px]"
              style={{
                borderColor: "var(--amber-400, #F59E0B)",
                background: "var(--amber-50, #FFFBEB)",
                color: "var(--amber-800, #92400E)",
              }}
              data-testid="pending-verification"
            >
              {pendingMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Username */}
            <div className="field">
              <label htmlFor="username" className="eyebrow text-[11px] text-[var(--ink-soft)] mb-1 block">
                {t("username") || "Username"}
              </label>
              <input
                id="username"
                className="input w-full"
                data-testid="input-username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder={t("usernamePlaceholder") || "Enter your username"}
                autoComplete="username"
                required
              />
            </div>

            {/* Password */}
            <div className="field">
              <label htmlFor="password" className="eyebrow text-[11px] text-[var(--ink-soft)] mb-1 block">
                {t("password") || "Password"}
              </label>
              <div className="relative">
                <input
                  id="password"
                  className="input w-full pe-10"
                  data-testid="input-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t("passwordPlaceholder") || "Enter your password"}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
                  aria-label={showPassword ? t("hidePassword") : t("showPassword")}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={loginMutation.isPending}
              data-testid="button-submit"
            >
              {loginMutation.isPending ? t("loading") || "Signing in…" : t("login") || "Sign in"}
            </button>
          </form>

          {/* Forgot password */}
          <div className="mt-4 text-center">
            <a
              href="/forgot-password"
              className="text-[12px] text-[var(--ink-muted)] underline-offset-4 hover:underline hover:text-[var(--teal-600)] transition-colors"
              data-testid="link-forgot-password"
            >
              {t("forgotPassword") || "Forgot your password?"}
            </a>
          </div>

          {/* Dev quick-login chips */}
          {IS_DEV && (
            <div className="mt-8 pt-5 border-t border-[var(--line)]">
              <div className="flex items-center gap-1.5 mb-3">
                <Zap className="w-3 h-3 text-[var(--ink-faint)]" />
                <span className="eyebrow text-[10px] text-[var(--ink-faint)]">
                  DEV QUICK LOGIN
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SEED_ACCOUNTS.map(acc => (
                  <button
                    key={acc.username}
                    type="button"
                    onClick={() => quickLogin(acc.username, acc.password)}
                    disabled={loginMutation.isPending}
                    className={cn(
                      "px-2.5 py-0.5 rounded-full text-[11px] font-medium border transition-colors",
                      "bg-[var(--surface-2)] text-[var(--ink-soft)] border-[var(--line)]",
                      "hover:bg-[var(--teal-50)] hover:text-[var(--teal-700)] hover:border-[var(--teal-200)]",
                      "disabled:opacity-50 disabled:cursor-not-allowed"
                    )}
                  >
                    {acc.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-[var(--ink-faint)] mt-6 text-center">
            {t("staffAccessOnly") || "Staff access only. Contact your administrator for credentials."}
          </p>
        </div>
      </div>
    </div>
  );
}
