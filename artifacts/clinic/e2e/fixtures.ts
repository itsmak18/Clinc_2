import { test as base, expect } from "@playwright/test";

type Fixtures = {
  /** Logs in via the real form (username matches src/mocks/handlers.ts's
   *  SEED_USERS) and waits for the authenticated shell (sidebar logout
   *  button) to render — proves navigation away from /login actually
   *  completed, not just that the URL changed. */
  loginAs: (username: string) => Promise<void>;
};

export const test = base.extend<Fixtures>({
  loginAs: async ({ page }, use) => {
    await use(async (username: string) => {
      await page.goto("/login");
      await page.getByTestId("input-username").fill(username);
      await page.getByTestId("input-password").fill("e2e-test-password");
      await page.getByTestId("button-submit").click();
      await expect(page.getByTestId("button-logout")).toBeVisible({ timeout: 10_000 });
    });
  },
});

export { expect };
