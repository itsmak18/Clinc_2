import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);

/**
 * Starts the MSW browser worker. Called once from main.tsx behind the
 * VITE_E2E build flag (AUD-FE-01) — never in production or the vitest/jsdom
 * unit suite, which has no service-worker support and doesn't need it.
 */
export async function startMockWorker(): Promise<void> {
  await worker.start({
    onUnhandledRequest: "warn",
  });
}
