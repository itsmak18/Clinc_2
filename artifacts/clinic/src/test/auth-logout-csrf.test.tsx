/**
 * auth-logout-csrf.test.tsx — F-P7-4 regression guard.
 *
 * `logout()` in hooks/auth.tsx is a hand-written POST `fetch` (not the Orval
 * customFetch), so it must manually read the `_csrf` cookie and send it as the
 * `X-CSRF-Token` header. This is exactly the path that regressed on 2026-05-13
 * (raw fetch dropping the header → logout CSRF). This test fails if that header
 * stops being attached.
 */
import { render, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/hooks/i18n";
import { AuthProvider, useAuth } from "@/hooks/auth";

function LogoutButton() {
  const { logout } = useAuth();
  return <button data-testid="logout" onClick={() => logout()}>logout</button>;
}

function renderWithProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider>
        <AuthProvider>
          <LogoutButton />
        </AuthProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

describe("logout() CSRF header (F-P7-4)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.cookie = "_csrf=test-csrf-token-123";
    // /auth/me on mount + /auth/logout on click both resolve to a benign 401-ish.
    fetchMock = vi.fn(() =>
      Promise.resolve({ ok: false, status: 401, json: async () => ({}) } as unknown as Response),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs /auth/logout with X-CSRF-Token read from the _csrf cookie", async () => {
    const { getByTestId } = renderWithProviders();
    fireEvent.click(getByTestId("logout"));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(c => String(c[0]).includes("/api/auth/logout"));
      expect(call, "expected a fetch to /api/auth/logout").toBeTruthy();
      const opts = (call as any[])[1];
      expect(opts.method).toBe("POST");
      expect(opts.credentials).toBe("include");
      expect(opts.headers["X-CSRF-Token"]).toBe("test-csrf-token-123");
    });
  });
});
