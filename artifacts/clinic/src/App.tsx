import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/auth";
import { I18nProvider } from "@/hooks/i18n";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import Layout from "@/components/Layout";
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
import NotFound from "@/pages/not-found";

setAuthTokenGetter(() => localStorage.getItem("clinic_token"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

function ProtectedRoutes() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Login />;
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/dashboard" component={Dashboard} />
        <Route path="/patients/:id" component={PatientDetail} />
        <Route path="/patients" component={Patients} />
        <Route path="/appointments" component={Appointments} />
        <Route path="/medical-records" component={MedicalRecords} />
        <Route path="/prescriptions" component={Prescriptions} />
        <Route path="/xray" component={XRay} />
        <Route path="/lab" component={Lab} />
        <Route path="/billing" component={Billing} />
        <Route path="/operations" component={Operations} />
        <Route path="/inventory" component={Inventory} />
        <Route path="/reports" component={Reports} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/users" component={Users} />
        <Route path="/audit" component={AuditLog} />
        <Route path="/settings" component={Settings} />
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
