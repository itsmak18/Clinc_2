import { useEffect, lazy, Suspense, Component, type ReactNode, type ErrorInfo } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
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

import { ShieldAlert } from "lucide-react";

// Route-level code splitting — each page is a separate chunk loaded on demand
const Login          = lazy(() => import("@/pages/Login"));
const ForgotPassword = lazy(() => import("@/pages/ForgotPassword"));
const VerifyDevice   = lazy(() => import("@/pages/VerifyDevice"));
const AccountDevices = lazy(() => import("@/pages/AccountDevices"));
const Dashboard    = lazy(() => import("@/pages/Dashboard"));
const Patients     = lazy(() => import("@/pages/Patients"));
const PatientDetail = lazy(() => import("@/pages/PatientDetail"));
const Appointments = lazy(() => import("@/pages/Appointments"));
const MedicalRecords = lazy(() => import("@/pages/MedicalRecords"));
const Prescriptions = lazy(() => import("@/pages/Prescriptions"));
const XRay         = lazy(() => import("@/pages/XRay"));
const Ultrasound   = lazy(() => import("@/pages/Ultrasound"));
const Lab          = lazy(() => import("@/pages/Lab"));
const Billing      = lazy(() => import("@/pages/Billing"));
const Operations   = lazy(() => import("@/pages/Operations"));
const Inventory    = lazy(() => import("@/pages/Inventory"));
const Reports      = lazy(() => import("@/pages/Reports"));
const Notifications = lazy(() => import("@/pages/Notifications"));
const Users        = lazy(() => import("@/pages/Users"));
const AuditLog     = lazy(() => import("@/pages/AuditLog"));
const Settings     = lazy(() => import("@/pages/Settings"));
const Triage       = lazy(() => import("@/pages/Triage"));
const Schedule     = lazy(() => import("@/pages/Schedule"));
const DoctorDashboard   = lazy(() => import("@/pages/DoctorDashboard"));
const DoctorConsult     = lazy(() => import("@/pages/DoctorConsult"));
const DoctorOrders      = lazy(() => import("@/pages/DoctorOrders"));
const DoctorInbox       = lazy(() => import("@/pages/DoctorInbox"));
const NurseVitals       = lazy(() => import("@/pages/NurseVitals"));
const FrontDeskCheckin  = lazy(() => import("@/pages/FrontDeskCheckin"));
const AccessDenied = lazy(() => import("@/pages/AccessDenied"));
const NotFound     = lazy(() => import("@/pages/not-found"));

// ── Per-route error reset ─────────────────────────────────────────────────────
// Wraps children in an ErrorBoundary keyed by current route, so an error on
// one page is cleared when the user navigates away.
function RouteErrorReset({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary key={location}>{children}</ErrorBoundary>;
}

// ── Error boundary ────────────────────────────────────────────────────────────
interface ErrorBoundaryState { hasError: boolean; error?: Error }

class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 text-center p-8">
          <ShieldAlert className="w-10 h-10 text-[var(--rose-500)]" />
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="text-sm text-[var(--ink-muted)] max-w-md">
            An unexpected error occurred. Refresh the page or contact support if this persists.
          </p>
          <button className="btn btn-outline btn-sm" onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
        <p className="text-sm text-[var(--ink-muted)]">
          You have been inactive for a while. For security, you will be automatically
          logged out in:
        </p>
        <p className="text-3xl font-mono font-bold text-center text-amber-600 py-2">
          {timeStr}
        </p>
        <p className="text-xs text-[var(--ink-muted)] text-center">
          Click below to stay logged in, or wait to be signed out.
        </p>
        <DialogFooter>
          <button className="btn btn-primary w-full" onClick={onStayLoggedIn}>
            Stay Logged In
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProtectedRoutes() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();

  // Session timeout: warn 2 min before JWT expiry (per-role TTL), fall back to 28/30 min defaults.
  const { showWarning, secondsLeft, stayLoggedIn } = useSessionTimeout({
    enabled: isAuthenticated,
    onLogout: logout,
    jwtExpUnix: user?.jwtExpUnix,
  });

  // Register 401 interceptor so expired tokens force logout immediately
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  if (isLoading) return null;

  // Public routes accessible without a session — order matters: these match
  // before we fall through to <Login />.
  if (typeof window !== "undefined") {
    const path = window.location.pathname;
    if (path === "/forgot-password") {
      return <Suspense fallback={null}><ForgotPassword /></Suspense>;
    }
    if (path === "/verify-device") {
      return <Suspense fallback={null}><VerifyDevice /></Suspense>;
    }
  }

  if (!isAuthenticated || !user) return <Suspense fallback={null}><Login /></Suspense>;


  const role = user.role;

  return (
    <>
      <SessionTimeoutWarning
        open={showWarning}
        secondsLeft={secondsLeft}
        onStayLoggedIn={stayLoggedIn}
      />
      <Layout>
        <Suspense fallback={null}>
        <RouteErrorReset>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/today">
            <Guard path="/today" role={role}><DoctorDashboard /></Guard>
          </Route>
          <Route path="/consult">
            <Guard path="/consult" role={role}><DoctorConsult /></Guard>
          </Route>
          <Route path="/orders">
            <Guard path="/orders" role={role}><DoctorOrders /></Guard>
          </Route>
          <Route path="/inbox">
            <Guard path="/inbox" role={role}><DoctorInbox /></Guard>
          </Route>
          <Route path="/checkin">
            <Guard path="/checkin" role={role}><FrontDeskCheckin /></Guard>
          </Route>
          <Route path="/vitals">
            <Guard path="/vitals" role={role}><NurseVitals /></Guard>
          </Route>
          <Route path="/account/devices" component={AccountDevices} />
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
        </RouteErrorReset>
        </Suspense>
      </Layout>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}

export default App;
