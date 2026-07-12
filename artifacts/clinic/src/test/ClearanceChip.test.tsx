import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/hooks/i18n";
import ClearanceChip from "@/components/ClearanceChip";

// Department payment-visibility contract (clearance-visibility plan D1):
// the chip shows the request's OWN payment state + line price and nothing
// else, and stays silent on pre-gate rows so flag-OFF UI is unchanged.

function chip(props: React.ComponentProps<typeof ClearanceChip>) {
  return render(
    <I18nProvider>
      <ClearanceChip {...props} />
    </I18nProvider>,
  );
}

beforeEach(() => localStorage.setItem("clinic_lang", "en"));

describe("ClearanceChip — state matrix", () => {
  it("cleared + charge → green Paid with the own-line amount (the go-signal)", () => {
    chip({ status: "cleared", charge: { amountCents: 15000 } });
    expect(screen.getByText(/Paid/)).toBeInTheDocument();
    expect(screen.getByText(/\$150\.00/)).toBeInTheDocument();
  });

  it("cleared WITHOUT charge (pre-gate/grandfathered row) → renders nothing", () => {
    const { container } = chip({ status: "cleared", charge: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("no status at all → renders nothing", () => {
    const { container } = chip({ status: undefined });
    expect(container).toBeEmptyDOMElement();
  });

  it("pending → amber Awaiting payment with amount and front-desk tooltip", () => {
    chip({ status: "pending", charge: { amountCents: 5000 } });
    const el = screen.getByText(/Awaiting payment/);
    expect(el).toBeInTheDocument();
    expect(screen.getByText(/\$50\.00/)).toBeInTheDocument();
    expect(el.closest("span")).toHaveAttribute("title", expect.stringMatching(/front desk/i));
  });

  it("pending without charge still warns (no amount shown)", () => {
    chip({ status: "pending", charge: null });
    expect(screen.getByText(/Awaiting payment/)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("overridden → override chip with amount still owed", () => {
    chip({ status: "overridden", charge: { amountCents: 10000 } });
    expect(screen.getByText(/Emergency override/)).toBeInTheDocument();
    expect(screen.getByText(/\$100\.00/)).toBeInTheDocument();
  });

  it("expired → expiry chip, no amount", () => {
    chip({ status: "expired", charge: { amountCents: 10000 } });
    expect(screen.getByText(/Payment expired/)).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it("renders Arabic labels under ar locale", () => {
    localStorage.setItem("clinic_lang", "ar");
    chip({ status: "cleared", charge: { amountCents: 15000 } });
    expect(screen.getByText(/مدفوع/)).toBeInTheDocument();
  });
});