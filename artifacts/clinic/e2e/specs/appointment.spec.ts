import { test, expect } from "../fixtures";

test.describe("Create appointment", () => {
  test("front desk books a new appointment and it appears in the list", async ({ page, loginAs }) => {
    // front_desk lands on /checkin (getLandingRoute), not /appointments —
    // navigate via the real sidebar link, exercising real navigation too.
    await loginAs("receptionist");
    await page.getByTestId("nav-appointments").click();
    await expect(page).toHaveURL(/\/appointments/);

    // front_desk defaults to the day-schedule view (Appointments.tsx); switch
    // to the list view so the created row is asserted against the same
    // DataTable rendering path this spec was written against.
    await page.getByRole("button", { name: "List" }).click();

    await page.getByTestId("button-new-appointment").click();

    // Patient: type-ahead search (>= 3 chars, 250ms debounce) then click the
    // mocked result (src/mocks/handlers.ts MOCK_PATIENTS id 501).
    await page.getByTestId("select-patient").fill("Fatima");
    await page.getByTestId("patient-result-501").click({ timeout: 10_000 });

    // Doctor: shadcn Command combobox — open it, click the single mocked doctor.
    await page.getByTestId("select-doctor").click();
    await page.getByText("Dr Ahmed", { exact: true }).click();

    // Scheduled time: any near-future datetime-local value.
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const localValue = new Date(future.getTime() - future.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    await page.getByTestId("input-scheduled-at").fill(localValue);

    // front_desk's "reason" field is optional (Appointments.tsx) — leave blank.
    await page.getByTestId("button-save-appointment").click();

    await expect(page.getByText("Fatima Al-Otaibi")).toBeVisible({ timeout: 10_000 });
  });
});
