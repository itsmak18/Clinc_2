import { useState } from "react";
import { Link } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity } from "lucide-react";

export default function ForgotPassword() {
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
          <span className="font-bold text-[var(--ink)]">MediCore</span>
        </div>

        <h1 className="text-2xl font-bold text-[var(--ink)] mb-1">Forgot password</h1>
        <p className="text-sm text-[var(--ink-muted)] mb-6">
          We&apos;ll email you a reset link if your account is on file.
        </p>

        {submitted ? (
          <div
            role="status"
            className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm"
            data-testid="forgot-password-confirmation"
          >
            If an account with that username exists, a reset link has been sent
            to the linked email. Check your inbox within the next few minutes.
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-xs font-medium">Username</Label>
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
              {busy ? "Sending…" : "Send reset link"}
            </button>
          </form>
        )}

        <div className="mt-6 text-center">
          <Link
            to="/login"
            className="text-xs text-[var(--ink-muted)] underline-offset-4 hover:underline"
          >
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
