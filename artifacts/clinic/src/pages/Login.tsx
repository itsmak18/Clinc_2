import { useState } from "react";
import { useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/auth";
import { useI18n } from "@/hooks/i18n";
import { getLandingRoute } from "@/lib/route-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";


export default function Login() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data: any) => {
        login(data.user);
        setLocation(getLandingRoute(data.user.role));
      },
      onError: () => {
        toast({ title: "Login failed", description: "Invalid username or password", variant: "destructive" });
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loginMutation.mutate({ data: { username, password } });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex bg-background">
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-2/5 bg-sidebar p-10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sidebar-primary flex items-center justify-center">
            <Activity className="w-5 h-5 text-sidebar-primary-foreground" />
          </div>
          <div>
            <div className="text-sm font-bold text-sidebar-foreground">MediCore</div>
            <div className="text-xs text-sidebar-foreground/50">Clinic Management System</div>
          </div>
        </div>
        <div>
          <blockquote className="text-sidebar-foreground/80 text-sm leading-relaxed italic">
            "Precision in care, efficiency in operation. Every record, every appointment, every decision — in one system."
          </blockquote>
        </div>
        <div className="space-y-2">
          {["Patient Records", "Appointment Management", "Lab & X-Ray", "Billing & Operations"].map(f => (
            <div key={f} className="flex items-center gap-2 text-xs text-sidebar-foreground/60">
              <div className="w-1.5 h-1.5 rounded-full bg-sidebar-primary" />
              {f}
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
              <Activity className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-foreground">MediCore</span>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-foreground">{t("login")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("loginSubtitle")} — Staff Portal</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs font-medium">{t("username")}</Label>
              <Input
                id="username"
                data-testid="input-username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter your username"
                autoComplete="username"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium">{t("password")}</Label>
              <div className="relative">
                <Input
                  id="password"
                  data-testid="input-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loginMutation.isPending}
              data-testid="button-submit"
            >
              {loginMutation.isPending ? t("loading") : t("login")}
            </Button>
          </form>

          <p className="text-xs text-muted-foreground mt-6 text-center">
            Staff access only. Contact your administrator for credentials.
          </p>
        </div>
      </div>
    </div>
  );
}
