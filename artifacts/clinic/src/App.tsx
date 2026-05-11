import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, UserRole } from "@/hooks/auth";
import { I18nProvider } from "@/hooks/i18n";
import { setUnauthorizedHandler } from "@workspace/api-client-react";
import { useSessionTimeout } from "@/hooks/useSessionTimeout";
import Layout from "@/components/Layout";
import { canAccessRoute } from "@/lib/route-access";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Patients from "@/pages/Patients";
import PatientDetail from "@/pages/PatientDetail";
import Appointments from "@/pages/Appointments";
import MedicalRecords from "@/pages/MedicalRecords";
import Prescriptions from "@/pages/Prescriptions";
import XRay from "@/pages/XRay";
import Ultrasound from "@/pages/Ultrasound";
import Lab from "@/pages/Lab";
import Billing from "@/pages/Billing";
import Operations from "@/pages/Operations";
import Inventory from "@/pages/Inventory";
import Reports from "@/pages/Reports";
import Notifications from "@/pages/Notifications";
import Users from "@/pages/Users";
import AuditLog from "@/pages/AuditLog";
import Settings from "@/pages/Settings";
import Triage from "@/pages/Triage";
import Schedule from "@/pages/Schedule";
import AccessDenied from "@/pages/AccessDenied";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function Guard({ path, role, children }: { path: string; role: UserRole; children: React.ReactNode }) {
  if (!canAccessRoute(path, role)) return <AccessDenied />;
  return <>{children}</>;
}

/** Warning dialog shown 2 min before auto-logout due to inactivity */
function SessionTimeoutWarning({
  open,
  secondsLeft,
  onStayLoggedIn,
}: {
  open: boolean;
  secondsLeft: number;
  onStayLoggedIn: () => void;
}) {
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = mins > 0
    ? `${mins}:${String(secs).padStart(2, "0")}`
    : `${secs}s`;

  return (
    <Dialog open={open}>
      <DialogContent className="max-w-sm" onInteractOutside={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <ShieldAlert className="w-5 h-5" />
            Session Expiring Soon
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          You have been inactive for a while. For security, you will be automatically
          logged out in:
        </p>
        <p className="text-3xl font-mono font-bold text-center text-amber-600 py-2">
          {timeStr}
        </p>
        <p className="text-xs text-muted-foreground text-center">
          Click below to stay logged in, or wait to be signed out.
        </p>
        <DialogFooter>
          <Button onClick={onStayLoggedIn} className="w-full">
            Stay Logged In
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProtectedRoutes() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();

  // Session timeout: warn at 28 min, logout at 30 min of inactivity
  const { showWarning, secondsLeft, stayLoggedIn } = useSessionTimeout({
    enabled: isAuthenticated,
    onLogout: logout,
  });

  // Register 401 interceptor so expired tokens force logout immediately
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  if (isLoading) return null;
  if (!isAuthenticated || !user) return <Login />;

  const role = user.role;

  return (
    <>
      <SessionTimeoutWarning
        open={showWarning}
        secondsLeft={secondsLeft}
        onStayLoggedIn={stayLoggedIn}
      />
      <Layout>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/patients/:id">
            <Guard path="/patients" role={role}><PatientDetail /></Guard>
          </Route>
          <Route path="/patients">
            <Guard path="/patients" role={role}><Patients /></Guard>
          </Route>
          <Route path="/appointments">
            <Guard path="/appointments" role={role}><Appointments /></Guard>
          </Route>
          <Route path="/schedule">
            <Guard path="/schedule" role={role}><Schedule /></Guard>
          </Route>
          <Route path="/triage">
            <Guard path="/triage" role={role}><Triage /></Guard>
          </Route>
          <Route path="/medical-records">
            <Guard path="/medical-records" role={role}><MedicalRecords /></Guard>
          </Route>
          <Route path="/prescriptions">
            <Guard path="/prescriptions" role={role}><Prescriptions /></Guard>
          </Route>
          <Route path="/xray">
            <Guard path="/xray" role={role}><XRay /></Guard>
          </Route>
          <Route path="/ultrasound">
            <Guard path="/ultrasound" role={role}><Ultrasound /></Guard>
          </Route>
          <Route path="/lab">
            <Guard path="/lab" role={role}><Lab /></Guard>
          </Route>
          <Route path="/billing">
            <Guard path="/billing" role={role}><Billing /></Guard>
          </Route>
          <Route path="/operations">
            <Guard path="/operations" role={role}><Operations /></Guard>
          </Route>
          <Route path="/inventory">
            <Guard path="/inventory" role={role}><Inventory /></Guard>
          </Route>
          <Route path="/reports">
            <Guard path="/reports" role={role}><Reports /></Guard>
          </Route>
          <Route path="/notifications" component={Notifications} />
          <Route path="/users">
            <Guard path="/users" role={role}><Users /></Guard>
          </Route>
          <Route path="/audit">
            <Guard path="/audit" role={role}><AuditLog /></Guard>
          </Route>
          <Route path="/settings">
            <Guard path="/settings" role={role}><Settings /></Guard>
          </Route>
          <Route component={NotFound} />
        </Switch>
      </Layout>
    </>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <I18nProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <ProtectedRoutes />
            </WouterRouter>
            <Toaster />
          </AuthProvider>
        </I18nProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
