import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import EditExpenseForm from "@/components/EditExpenseForm";
import type { HouseholdInfo } from "@/components/useHousehold";
import {
  getExpense,
  getReceipt,
  rerunExtraction,
  type Expense,
  type ExtractedItem,
  type Receipt,
} from "@/lib/api";

// Sam lives with Alex. No test calls the real backend or navigates for real.
const HOUSEHOLD: HouseholdInfo = {
  myId: 1,
  household: {
    id: 7,
    name: "Apartment 4B",
    invite_code: "AF6S4JQ8",
    members: [
      { id: 1, email: "sam@example.com" },
      { id: 2, email: "alex@example.com" },
    ],
  },
};
vi.mock("@/components/useHousehold", () => ({ useHousehold: () => HOUSEHOLD }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getExpense: vi.fn(),
  getReceipt: vi.fn(),
  rerunExtraction: vi.fn(),
  updateExpense: vi.fn(),
  previewItemSplit: vi.fn(() => new Promise(() => {})),
}));

const EXPENSE: Expense = {
  id: 106,
  receipt_id: 10,
  merchant: "FreshCo",
  date: "2026-10-08",
  subtotal: "10.48",
  tax: null,
  total: "10.48",
  currency: "CAD",
  category: "Groceries",
  notes: null,
  was_edited: false,
  is_shared: false,
  shares: [],
  split_items: null,
  recurring_id: null,
  created_at: "2026-10-08T14:32:07Z",
};

const ITEMS: ExtractedItem[] = [
  { name: "MILK", quantity: null, price: "6.49", is_taxable: false },
  { name: "BREAD", quantity: null, price: "3.99", is_taxable: false },
];

function receipt(items: ExtractedItem[]): Receipt {
  return {
    id: 10,
    status: "extracted",
    raw_text: "FRESHCO\nMILK 6.49\nBREAD 3.99",
    error_message: null,
    created_at: "2026-10-08T14:30:00Z",
    warnings: [],
    needs_review: false,
    extracted_fields: {
      merchant: "FreshCo",
      date: "2026-10-08",
      subtotal: "10.48",
      tax: null,
      total: "10.48",
      currency: null,
      category: "Groceries",
      items,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getExpense).mockResolvedValue(EXPENSE);
});

test("an expense from a receipt offers the receipt's items for splitting", async () => {
  vi.mocked(getReceipt).mockResolvedValue(receipt(ITEMS));
  render(<EditExpenseForm expenseId={106} />);

  await userEvent.click(await screen.findByLabelText("Share this expense with my household"));

  expect(getReceipt).toHaveBeenCalledWith(10);
  expect(screen.getByLabelText("By item")).toBeChecked();
  expect(screen.getByLabelText("Name of item 1")).toHaveValue("MILK");
  expect(screen.getByLabelText("Name of item 2")).toHaveValue("BREAD");
  expect(screen.queryByRole("button", { name: "Read the items with AI" })).not.toBeInTheDocument();
});

test("a receipt scanned before items were read can have them read now", async () => {
  vi.mocked(getReceipt).mockResolvedValue(receipt([]));
  vi.mocked(rerunExtraction).mockResolvedValue(receipt(ITEMS));
  render(<EditExpenseForm expenseId={106} />);

  await userEvent.click(await screen.findByRole("button", { name: "Read the items with AI" }));

  expect(rerunExtraction).toHaveBeenCalledWith(10);
  // The offer goes away, and sharing now starts with the items.
  expect(screen.queryByRole("button", { name: "Read the items with AI" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("Share this expense with my household"));
  expect(screen.getByLabelText("Name of item 2")).toHaveValue("BREAD");
});

test("a failed reading says why and can be tried again", async () => {
  vi.mocked(getReceipt).mockResolvedValue(receipt([]));
  vi.mocked(rerunExtraction).mockRejectedValue(new Error("Could not reach the AI service."));
  render(<EditExpenseForm expenseId={106} />);

  await userEvent.click(await screen.findByRole("button", { name: "Read the items with AI" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the AI service.");
  expect(screen.getByRole("button", { name: "Read the items with AI" })).toBeEnabled();
});

test("an expense typed in by hand has no receipt to read", async () => {
  vi.mocked(getExpense).mockResolvedValue({ ...EXPENSE, receipt_id: null });
  render(<EditExpenseForm expenseId={106} />);

  await screen.findByLabelText("Merchant");

  expect(getReceipt).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: "Read the items with AI" })).not.toBeInTheDocument();
});

test("the expense can still be edited when its receipt cannot be loaded", async () => {
  vi.mocked(getReceipt).mockRejectedValue(new Error("Receipt not found"));
  render(<EditExpenseForm expenseId={106} />);

  expect(await screen.findByLabelText("Merchant")).toHaveValue("FreshCo");
});
