import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth, UserRole } from "@/hooks/auth";
import { I18nProvider } from "@/hooks/i18n";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import Layout, { canAccessRoute } from "@/components/Layout";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Patients from "@/pages/Patients";
import PatientDetail from "@/pages/PatientDetail";
import Appointments from "@/pages/Appointments";
import MedicalRecords from "@/pages/MedicalRecords";
import Prescriptions from "@/pages/Prescriptions";
import XRay from "@/pages/XRay";
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
import AccessDenied from "@/pages/AccessDenied";
import NotFound from "@/pages/not-found";

setAuthTokenGetter(() => localStorage.getItem("clinic_token"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function Guard({ path, role, children }: { path: string; role: UserRole; children: React.ReactNode }) {
  if (!canAccessRoute(path, role)) return <AccessDenied />;
  return <>{children}</>;
}

function ProtectedRoutes() {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated || !user) return <Login />;

  const role = user.role;

  return (
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
