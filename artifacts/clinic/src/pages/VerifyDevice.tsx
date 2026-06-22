import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/hooks/auth";
import { getLandingRoute } from "@/lib/route-access";
import { Activity, CheckCircle2, AlertTriangle } from "lucide-react";

type State =
  | { kind: "idle" }
  | { kind: "verifying" }
  | { kind: "ok" }
  | { kind: "error"; message: string };

export default function VerifyDevice() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("t");
    if (!token) {
      setState({ kind: "error", message: "Missing verification token." });
      return;
    }

    setState({ kind: "verifying" });
    (async () => {
      try {
        const res = await customFetch<{ user: { role: string } }>(
          "/api/auth/verify-device",
          {
            method: "POST",
            body: JSON.stringify({ token }),
          },
        );
        login(res.user as never);
        setState({ kind: "ok" });
        setTimeout(
          () => setLocation(getLandingRoute(res.user.role as never)),
          1200,
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : "Verification failed. The link may have expired.";
        setState({ kind: "error", message });
      }
    })();
  }, [login, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center p-8 bg-background">
      <div className="w-full max-w-sm text-center">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 rounded bg-[var(--teal-600)] flex items-center justify-center">
            <Activity className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-[var(--ink)]">Wateen Clinic</span>
        </div>

        {state.kind === "verifying" && (
          <p className="text-sm text-[var(--ink-muted)]">Verifying device…</p>
        )}

        {state.kind === "ok" && (
          <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-4">
            <CheckCircle2 className="w-6 h-6 mx-auto text-emerald-600 mb-2" />
            <div className="text-sm">Device verified. Signing you in…</div>
          </div>
        )}

        {state.kind === "error" && (
          <div className="rounded-md border border-[var(--rose-500)]/40 bg-[var(--rose-500)]/5 p-4">
            <AlertTriangle className="w-6 h-6 mx-auto text-[var(--rose-500)] mb-2" />
            <div className="text-sm">{state.message}</div>
            <a
              href="/login"
              className="mt-3 inline-block text-xs underline underline-offset-4"
            >
              Back to sign in
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
