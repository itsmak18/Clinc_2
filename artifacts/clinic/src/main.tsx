import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

async function bootstrap() {
  // AUD-FE-01: MSW's browser worker must be running BEFORE the app's first
  // fetch, so it's awaited here rather than started fire-and-forget from
  // inside App. Only ever set by Playwright's webServer (playwright.config.ts)
  // — absent in dev, and statically stripped from production builds (Vite
  // dead-code-eliminates the branch, so no msw/handlers code ships to users).
  if (import.meta.env.VITE_E2E === "1") {
    const { startMockWorker } = await import("./mocks/browser");
    await startMockWorker();
  }

  createRoot(document.getElementById("root")!).render(<App />);

  // Register service worker for SPA shell caching + offline resilience.
  // Only active in production builds — Vite dev server handles HMR instead.
  // (MSW also uses a service worker; VITE_E2E only ever runs in dev mode, so
  // this branch and the MSW branch above are mutually exclusive in practice.)
  if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // SW registration failure is non-fatal; the app functions normally without it.
      });
    });
  }
}

void bootstrap();
