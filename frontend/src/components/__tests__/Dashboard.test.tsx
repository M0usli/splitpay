import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import Dashboard, { shiftMonth } from "@/components/Dashboard";
import { getStatsSummary, type StatsSummary } from "@/lib/api";
import { currentMonth } from "@/lib/format";

// No test calls the real backend. The charts draw with a library that needs
// a real browser, so they are replaced with nothing here.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getStatsSummary: vi.fn(),
}));
vi.mock("@/components/CategoryChart", () => ({ default: () => null }));
vi.mock("@/components/MonthlyChart", () => ({ default: () => null }));
vi.mock("@/components/TopMerchants", () => ({ default: () => null }));

/** A summary for `month`, whose trend ends with that month. */
function summaryFor(month: string): StatsSummary {
  return {
    month,
    currency: "CAD",
    month_total: "203.24",
    expense_count: 4,
    by_category: [],
    monthly_totals: [
      { month: shiftMonth(month, -1), total: "150.00" },
      { month, total: "203.24" },
    ],
    top_merchants: [],
  } as unknown as StatsSummary;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStatsSummary).mockImplementation(async (month: string) => summaryFor(month));
});

test("months step back and forward, carrying over the year", () => {
  expect(shiftMonth("2026-10", -1)).toBe("2026-09");
  expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  expect(shiftMonth("2025-12", 1)).toBe("2026-01");
  expect(shiftMonth("2026-10", -12)).toBe("2025-10");
});

test("opens on this month with the total and the change from last month", async () => {
  render(<Dashboard />);

  expect(await screen.findByText("$203.24")).toBeInTheDocument();
  expect(screen.getByText(/\$53\.24 more than/)).toBeInTheDocument();
  expect(getStatsSummary).toHaveBeenCalledWith(currentMonth());
  // There is no next month yet, and no need for a "This month" button.
  expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "This month" })).not.toBeInTheDocument();
});

test("the arrows move one month at a time, and This month comes back", async () => {
  render(<Dashboard />);
  await screen.findByText("$203.24");

  await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
  await userEvent.click(await screen.findByRole("button", { name: "Previous month" }));

  expect(getStatsSummary).toHaveBeenLastCalledWith(shiftMonth(currentMonth(), -2));
  expect(screen.getByRole("button", { name: "Next month" })).toBeEnabled();

  await userEvent.click(screen.getByRole("button", { name: "This month" }));

  expect(getStatsSummary).toHaveBeenLastCalledWith(currentMonth());
});

test("says so when the dashboard cannot be loaded", async () => {
  vi.mocked(getStatsSummary).mockRejectedValue(new Error("Could not reach the backend."));
  render(<Dashboard />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the backend.");
});
