import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import ExpenseList from "@/components/ExpenseList";
import { deleteExpense, listExpenses, type Expense } from "@/lib/api";

// Keep the real module, but replace the two functions that call the backend.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listExpenses: vi.fn(),
  deleteExpense: vi.fn(),
}));

const EXPENSES: Expense[] = [
  {
    id: 1,
    receipt_id: null,
    merchant: "FreshCo",
    date: "2026-10-08",
    subtotal: null,
    tax: null,
    total: "38.47",
    currency: "CAD",
    category: "Groceries",
    notes: null,
    was_edited: false,
    is_shared: false,
    shares: [],
    split_items: null,
    recurring_id: null,
    created_at: "2026-10-08T14:32:07Z",
  },
  {
    id: 2,
    receipt_id: null,
    merchant: "Tim Hortons",
    date: "2026-10-03",
    subtotal: null,
    tax: null,
    total: "6.64",
    currency: "CAD",
    category: "Dining",
    notes: null,
    was_edited: false,
    is_shared: false,
    shares: [],
    split_items: null,
    recurring_id: null,
    created_at: "2026-10-03T08:14:00Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("shows the expenses with a count and total", async () => {
  vi.mocked(listExpenses).mockResolvedValue(EXPENSES);
  render(<ExpenseList />);

  expect(screen.getByText("Loading expenses…")).toBeInTheDocument();
  expect(await screen.findByText("2 expenses · $45.11")).toBeInTheDocument();
  expect(screen.getByText("Tim Hortons")).toBeInTheDocument();
});

test("invites the user to add something when there are no expenses", async () => {
  vi.mocked(listExpenses).mockResolvedValue([]);
  render(<ExpenseList />);

  expect(await screen.findByText(/No expenses yet/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Upload a receipt" })).toHaveAttribute("href", "/upload");
});

test("shows the error when the list cannot be loaded", async () => {
  vi.mocked(listExpenses).mockRejectedValue(
    new Error("Could not reach the backend. Is it running?"),
  );
  render(<ExpenseList />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the backend.");
});

test("asks the backend again when a filter changes", async () => {
  const user = userEvent.setup();
  vi.mocked(listExpenses).mockResolvedValue(EXPENSES);
  render(<ExpenseList />);
  await screen.findByText("FreshCo");

  await user.selectOptions(screen.getByLabelText("Category"), "Dining");

  expect(listExpenses).toHaveBeenLastCalledWith({ month: "", category: "Dining" });
});

test("removes a row after the user confirms the delete", async () => {
  const user = userEvent.setup();
  vi.mocked(listExpenses).mockResolvedValue(EXPENSES);
  vi.mocked(deleteExpense).mockResolvedValue(undefined);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<ExpenseList />);

  await user.click(await screen.findByRole("button", { name: "Delete FreshCo" }));

  expect(deleteExpense).toHaveBeenCalledWith(1);
  expect(await screen.findByText("1 expense · $6.64")).toBeInTheDocument();
  expect(screen.queryByText("FreshCo")).not.toBeInTheDocument();
});

test("keeps the row when the user cancels the delete", async () => {
  const user = userEvent.setup();
  vi.mocked(listExpenses).mockResolvedValue(EXPENSES);
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<ExpenseList />);

  await user.click(await screen.findByRole("button", { name: "Delete FreshCo" }));

  expect(deleteExpense).not.toHaveBeenCalled();
  expect(screen.getByText("FreshCo")).toBeInTheDocument();
});
