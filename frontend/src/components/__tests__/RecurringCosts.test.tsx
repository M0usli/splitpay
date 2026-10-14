import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import RecurringCosts from "@/components/RecurringCosts";
import {
  createRecurring,
  deleteRecurring,
  listRecurring,
  runRecurring,
  updateRecurring,
  type Expense,
  type Recurring,
} from "@/lib/api";

// No test calls the real backend, and nobody here is in a household.
vi.mock("@/components/useHousehold", () => ({ useHousehold: () => null }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  createRecurring: vi.fn(),
  deleteRecurring: vi.fn(),
  listRecurring: vi.fn(),
  runRecurring: vi.fn(),
  updateRecurring: vi.fn(),
}));

const RENT: Recurring = {
  id: 3,
  merchant: "Rent",
  total: "1500.00",
  currency: "CAD",
  category: "Bills & Utilities",
  notes: null,
  day_of_month: 1,
  start_date: "2026-10-01",
  is_active: true,
  is_shared: false,
  shares: null,
  next_date: "2026-11-01",
  created_at: "2026-10-11T09:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listRecurring).mockResolvedValue([RENT]);
  vi.mocked(runRecurring).mockResolvedValue([]);
  vi.mocked(createRecurring).mockResolvedValue(RENT);
  vi.mocked(updateRecurring).mockResolvedValue(RENT);
  vi.mocked(deleteRecurring).mockResolvedValue(undefined);
});

test("lists each cost with its amount, day and next date", async () => {
  render(<RecurringCosts />);

  const list = within(await screen.findByRole("region", { name: "Your recurring costs" }));
  expect(list.getByText("Rent")).toBeInTheDocument();
  expect(list.getByText("$1,500.00")).toBeInTheDocument();
  expect(list.getByText(/On the 1st of each month\. Next: 2026-11-01\./)).toBeInTheDocument();
});

test("says so when there are none", async () => {
  vi.mocked(listRecurring).mockResolvedValue([]);
  render(<RecurringCosts />);

  expect(await screen.findByText(/None yet/)).toBeInTheDocument();
});

test("adding a cost saves it and then makes any expense that is due", async () => {
  vi.mocked(listRecurring).mockResolvedValue([]);
  vi.mocked(runRecurring).mockResolvedValue([{ id: 1 } as Expense]);
  render(<RecurringCosts />);

  await userEvent.type(await screen.findByLabelText("What is it for?"), "Internet");
  await userEvent.type(screen.getByLabelText("Amount each month"), "85");
  await userEvent.click(screen.getByRole("button", { name: "Bills & Utilities" }));
  await userEvent.click(screen.getByRole("button", { name: "15th" }));
  await userEvent.click(screen.getByRole("button", { name: "Add recurring cost" }));

  expect(createRecurring).toHaveBeenCalledWith({
    merchant: "Internet",
    total: "85",
    currency: "CAD",
    category: "Bills & Utilities",
    notes: null,
    day_of_month: 15,
    is_active: true,
    is_shared: false,
    shares: null,
  });
  expect(runRecurring).toHaveBeenCalledOnce();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "1 expense was added to your expenses.",
  );
  // The form is empty again, ready for the next cost.
  expect(screen.getByLabelText("What is it for?")).toHaveValue("");
  expect(screen.getByLabelText("Amount each month")).toHaveValue(null);
});

test("stopping a cost keeps everything else about it", async () => {
  render(<RecurringCosts />);

  await userEvent.click(await screen.findByRole("button", { name: "Stop Rent" }));

  expect(updateRecurring).toHaveBeenCalledWith(
    3,
    expect.objectContaining({ merchant: "Rent", total: "1500.00", is_active: false }),
  );
});

test("a stopped cost can be resumed", async () => {
  vi.mocked(listRecurring).mockResolvedValue([{ ...RENT, is_active: false, next_date: null }]);
  render(<RecurringCosts />);

  expect(await screen.findByText(/Stopped\./)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Resume Rent" }));

  expect(updateRecurring).toHaveBeenCalledWith(3, expect.objectContaining({ is_active: true }));
});

test("editing fills the form with the cost and saves the change", async () => {
  render(<RecurringCosts />);

  await userEvent.click(await screen.findByRole("button", { name: "Edit Rent" }));
  const amount = screen.getByLabelText("Amount each month");
  expect(amount).toHaveValue(1500);
  await userEvent.clear(amount);
  await userEvent.type(amount, "1550");
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

  expect(updateRecurring).toHaveBeenCalledWith(
    3,
    expect.objectContaining({ merchant: "Rent", total: "1550", day_of_month: 1 }),
  );
  expect(createRecurring).not.toHaveBeenCalled();
});

test("deleting asks first and can be cancelled", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<RecurringCosts />);

  await userEvent.click(await screen.findByRole("button", { name: "Delete Rent" }));
  expect(deleteRecurring).not.toHaveBeenCalled();

  confirm.mockReturnValue(true);
  await userEvent.click(screen.getByRole("button", { name: "Delete Rent" }));
  expect(deleteRecurring).toHaveBeenCalledWith(3);
  confirm.mockRestore();
});

test("a failed save shows the reason and keeps what was typed", async () => {
  vi.mocked(listRecurring).mockResolvedValue([]);
  vi.mocked(createRecurring).mockRejectedValue(new Error("The database is not available"));
  render(<RecurringCosts />);

  await userEvent.type(await screen.findByLabelText("What is it for?"), "Hydro");
  await userEvent.type(screen.getByLabelText("Amount each month"), "60");
  await userEvent.click(screen.getByRole("button", { name: "Bills & Utilities" }));
  await userEvent.click(screen.getByRole("button", { name: "Add recurring cost" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("The database is not available");
  expect(screen.getByLabelText("What is it for?")).toHaveValue("Hydro");
});

test("the green card adds up the running costs", async () => {
  render(<RecurringCosts />);

  const card = within(await screen.findByRole("region", { name: "Every month" }));
  expect(card.getByText("$1,500.00")).toBeInTheDocument();
  expect(card.getByText("1 running cost")).toBeInTheDocument();
});

test("a common cost is one tap: it fills in the name and the category", async () => {
  vi.mocked(listRecurring).mockResolvedValue([]);
  render(<RecurringCosts />);

  await userEvent.click(await screen.findByRole("button", { name: "Gym" }));

  expect(screen.getByLabelText("What is it for?")).toHaveValue("Gym");
  expect(screen.getByRole("button", { name: "Health" })).toHaveAttribute("aria-pressed", "true");
});

test("saving without a category says what is missing", async () => {
  vi.mocked(listRecurring).mockResolvedValue([]);
  render(<RecurringCosts />);

  await userEvent.type(await screen.findByLabelText("What is it for?"), "Gym");
  await userEvent.type(screen.getByLabelText("Amount each month"), "40");
  await userEvent.click(screen.getByRole("button", { name: "Add recurring cost" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Choose a category.");
  expect(createRecurring).not.toHaveBeenCalled();
});
