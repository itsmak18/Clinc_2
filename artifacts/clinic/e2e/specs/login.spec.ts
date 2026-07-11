import { test, expect } from "../fixtures";

test.describe("Login -> Dashboard", () => {
  test("admin logs in and lands on the authenticated dashboard", async ({ page, loginAs }) => {
    await loginAs("admin");

    // admin/super_admin fall through to the generic "/dashboard" landing
    // route (route-access.ts getLandingRoute default branch).
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId("button-logout")).toBeVisible();
  });
});
