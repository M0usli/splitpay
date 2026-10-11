import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import ExpenseTable from "@/components/ExpenseTable";
import type { Expense } from "@/lib/api";

/** A complete expense for tests; pass only the fields a test cares about. */
function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
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
    created_at: "2026-10-08T14:32:07Z",
    ...overrides,
  };
}

test("shows one row per expense with a formatted total", () => {
  const expenses = [makeExpense(), makeExpense({ id: 2, merchant: "Rogers", total: "85" })];
  render(<ExpenseTable expenses={expenses} deletingId={null} onDelete={() => {}} />);

  const rows = screen.getAllByRole("row").slice(1); // skip the header row
  expect(rows).toHaveLength(2);
  expect(within(rows[0]).getByText("$38.47")).toBeInTheDocument();
  expect(within(rows[1]).getByText("$85.00")).toBeInTheDocument();
});

test("links to the receipt only when the expense came from one", () => {
  const expenses = [makeExpense({ receipt_id: 7 }), makeExpense({ id: 2, merchant: "Rogers" })];
  render(<ExpenseTable expenses={expenses} deletingId={null} onDelete={() => {}} />);

  const links = screen.getAllByRole("link", { name: "receipt" });
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute("href", "/receipts/7");
});

test("tells the parent which expense to delete", async () => {
  const user = userEvent.setup();
  const onDelete = vi.fn();
  const expense = makeExpense();
  render(<ExpenseTable expenses={[expense]} deletingId={null} onDelete={onDelete} />);

  await user.click(screen.getByRole("button", { name: "Delete FreshCo" }));

  expect(onDelete).toHaveBeenCalledWith(expense);
});

test("disables the delete button of the row being deleted", () => {
  render(<ExpenseTable expenses={[makeExpense()]} deletingId={1} onDelete={() => {}} />);

  expect(screen.getByRole("button", { name: "Delete FreshCo" })).toBeDisabled();
});
