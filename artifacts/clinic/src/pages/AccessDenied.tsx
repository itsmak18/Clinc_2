import { useLocation } from "wouter";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/hooks/i18n";

export default function AccessDenied() {
  const [, setLocation] = useLocation();
  const { isRtl } = useI18n();

  return (
    <div
      className="flex flex-col items-center justify-center h-full py-24 text-center px-6"
      dir={isRtl ? "rtl" : "ltr"}
      data-testid="page-access-denied"
    >
      <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
        <ShieldOff className="w-7 h-7 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold text-foreground mb-1">Access Denied</h2>
      <p className="text-sm text-muted-foreground max-w-xs mb-6">
        You don't have permission to view this page. Contact your administrator if you believe this is a mistake.
      </p>
      <Button size="sm" onClick={() => setLocation("/dashboard")} data-testid="button-go-dashboard">
        Go to Dashboard
      </Button>
    </div>
  );
}
