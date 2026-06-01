import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/hooks/i18n";
import { canAccessRoute } from "@/lib/route-access";
import AccessDenied from "@/pages/AccessDenied";
import type { UserRole } from "@/hooks/auth";

// Mirrors App.tsx Guard (line 101) using a direct (non-lazy) AccessDenied import
// so tests run synchronously without Suspense gymnastics.
function TestGuard({
  path,
  role,
  children,
}: {
  path: string;
  role: UserRole;
  children: React.ReactNode;
}) {
  if (!canAccessRoute(path, role)) return <AccessDenied />;
  return <>{children}</>;
}

function Providers({ children }: { children: React.ReactNode }) {
  return <I18nProvider>{children}</I18nProvider>;
}

describe("Guard — access denied", () => {
  it("renders the AccessDenied panel when the role is not allowed on the route", () => {
    // /settings: roles ["super_admin", "admin"] — nurse is not in that list
    render(
      <Providers>
        <TestGuard path="/settings" role="nurse">
          <div data-testid="guarded-content">secret</div>
        </TestGuard>
      </Providers>,
    );

    expect(screen.getByTestId("page-access-denied")).toBeInTheDocument();
    expect(screen.queryByTestId("guarded-content")).not.toBeInTheDocument();
  });

  it("renders the AccessDenied panel in Arabic locale when language is ar", () => {
    localStorage.setItem("clinic_lang", "ar");
    render(
      <Providers>
        <TestGuard path="/settings" role="nurse">
          <div>content</div>
        </TestGuard>
      </Providers>,
    );

    expect(screen.getByTestId("page-access-denied")).toBeInTheDocument();
    // Bilingual check — Arabic heading text rendered
    expect(screen.getByText("تم رفض الوصول")).toBeInTheDocument();
  });
});

describe("Guard — access allowed", () => {
  it("renders children when the role is allowed on the route", () => {
    // /patients: includes nurse
    render(
      <Providers>
        <TestGuard path="/patients" role="nurse">
          <div data-testid="guarded-content">patients list</div>
        </TestGuard>
      </Providers>,
    );

    expect(screen.getByTestId("guarded-content")).toBeInTheDocument();
    expect(screen.queryByTestId("page-access-denied")).not.toBeInTheDocument();
  });

  it("super_admin sees children on every route (bypass invariant)", () => {
    render(
      <Providers>
        <TestGuard path="/settings" role="super_admin">
          <div data-testid="admin-content">admin panel</div>
        </TestGuard>
      </Providers>,
    );

    expect(screen.getByTestId("admin-content")).toBeInTheDocument();
    expect(screen.queryByTestId("page-access-denied")).not.toBeInTheDocument();
  });
});
