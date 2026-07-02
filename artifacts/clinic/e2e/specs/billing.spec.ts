import { test, expect } from "../fixtures";

test.describe("Create billing invoice", () => {
  test("front desk creates an invoice from a custom line item", async ({ page, loginAs }) => {
    // Billing SoD (CLAUDE.md): front_desk creates invoices; billing_manager/
    // admin pay/cancel. front_desk lands on /checkin — navigate to Billing
    // via the real sidebar link.
    await loginAs("receptionist");
    await page.getByTestId("nav-billing").click();
    await expect(page).toHaveURL(/\/billing/);

    await page.getByTestId("button-create-invoice").click();

    // Patient: type-ahead search (src/mocks/handlers.ts MOCK_PATIENTS id 502).
    await page.getByTestId("select-patient").fill("Khalid");
    await page.getByTestId("patient-result-502").click({ timeout: 10_000 });

    // Fill the first (default, empty) line item directly rather than via the
    // service-catalog picker — a custom line is a first-class supported path
    // (Billing.tsx's "customLineHint" copy) and avoids the cmdk combobox.
    await page.getByPlaceholder("Description").fill("Consultation");
    await page.getByPlaceholder("Quantity").fill("1");
    await page.getByPlaceholder("Unit Price").fill("150");

    // Save & Pay Now — createInvoice is a point-of-sale flow (markPaid: true),
    // so no separate pay step is needed.
    await page.getByTestId("button-save-invoice").click();

    // A "Invoice created" confirmation dialog appears immediately after — the
    // same text also appears in a toast + an ARIA live-region announcement,
    // so scope to the dialog heading specifically (Playwright strict mode
    // correctly rejects the ambiguous plain-text match across all three).
    await expect(page.getByRole("heading", { name: "Invoice created" })).toBeVisible({ timeout: 10_000 });
    // Dismiss via Escape rather than a "Close" button — Radix's own built-in
    // dialog-close control and the app's explicit Close button both resolve
    // to the same accessible name, which Playwright strict mode (correctly)
    // rejects as ambiguous. Escape exercises the same onOpenChange(false)
    // handler Radix wires up for both.
    await page.keyboard.press("Escape");

    // The new invoice is now the first row in the underlying list.
    await expect(page.getByText("Khalid Al-Harbi")).toBeVisible({ timeout: 10_000 });
  });
});
