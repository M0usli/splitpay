import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import BankImport from "@/components/BankImport";
import {
  addBankTransaction,
  connectBank,
  createBankLinkToken,
  getBankStatus,
  ignoreBankTransaction,
  listBankTransactions,
  removeBankConnection,
  syncBank,
  type BankStatus,
  type BankTransaction,
} from "@/lib/api";
import { openPlaidLink } from "@/lib/plaidLink";

// No test calls the real backend, and Plaid's window is never really opened.
vi.mock("@/lib/plaidLink", () => ({ openPlaidLink: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  addBankTransaction: vi.fn(),
  connectBank: vi.fn(),
  createBankLinkToken: vi.fn(),
  getBankStatus: vi.fn(),
  ignoreBankTransaction: vi.fn(),
  listBankTransactions: vi.fn(),
  removeBankConnection: vi.fn(),
  syncBank: vi.fn(),
}));

const NOT_SET_UP: BankStatus = { configured: false, connections: [] };
const NO_BANK: BankStatus = { configured: true, connections: [] };
const ONE_BANK: BankStatus = {
  configured: true,
  connections: [{ id: 4, institution_name: "First Platypus Bank", created_at: "2026-10-11T09:00:00Z" }],
};

const COFFEE: BankTransaction = {
  id: 21,
  connection_id: 4,
  name: "Starbucks",
  amount: "4.33",
  currency: "USD",
  date: "2026-10-05",
  category: "Dining",
  status: "new",
  expense_id: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getBankStatus).mockResolvedValue(ONE_BANK);
  vi.mocked(listBankTransactions).mockResolvedValue([COFFEE]);
});

test("explains how to set the feature up when the keys are missing", async () => {
  vi.mocked(getBankStatus).mockResolvedValue(NOT_SET_UP);
  render(<BankImport />);

  expect(await screen.findByText("The bank connection is not set up yet")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Connect a sandbox bank" })).not.toBeInTheDocument();
});

test("always says that the banks are pretend", async () => {
  render(<BankImport />);

  expect(await screen.findByText(/Sandbox only/)).toBeInTheDocument();
  expect(screen.getByText("user_good")).toBeInTheDocument();
});

test("connecting goes through the three steps in order", async () => {
  vi.mocked(getBankStatus).mockResolvedValue(NO_BANK);
  vi.mocked(listBankTransactions).mockResolvedValue([]);
  vi.mocked(createBankLinkToken).mockResolvedValue({ link_token: "link-sandbox-1" });
  vi.mocked(openPlaidLink).mockResolvedValue({
    publicToken: "public-sandbox-1",
    institutionName: "First Platypus Bank",
  });
  render(<BankImport />);

  await userEvent.click(await screen.findByRole("button", { name: "Connect a sandbox bank" }));

  expect(openPlaidLink).toHaveBeenCalledWith("link-sandbox-1");
  expect(connectBank).toHaveBeenCalledWith("public-sandbox-1", "First Platypus Bank");
  expect(await screen.findByRole("status")).toHaveTextContent("First Platypus Bank is connected");
});

test("closing Plaid's window without connecting changes nothing", async () => {
  vi.mocked(createBankLinkToken).mockResolvedValue({ link_token: "link-sandbox-1" });
  vi.mocked(openPlaidLink).mockResolvedValue(null);
  render(<BankImport />);

  await userEvent.click(await screen.findByRole("button", { name: "Connect a sandbox bank" }));

  expect(connectBank).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

test("importing says how many transactions came in", async () => {
  vi.mocked(syncBank).mockResolvedValue({ imported: 3, removed: 0 });
  render(<BankImport />);

  await userEvent.click(await screen.findByRole("button", { name: "Import transactions" }));

  expect(await screen.findByRole("status")).toHaveTextContent("3 transactions imported");
});

test("an import that finds nothing suggests trying again", async () => {
  vi.mocked(syncBank).mockResolvedValue({ imported: 0, removed: 0 });
  render(<BankImport />);

  await userEvent.click(await screen.findByRole("button", { name: "Import transactions" }));

  expect(await screen.findByRole("status")).toHaveTextContent("Nothing new to import");
});

test("lists what is waiting for review with its amount and suggested category", async () => {
  render(<BankImport />);

  const review = within(await screen.findByRole("region", { name: "To review (1)" }));
  expect(review.getByText("Starbucks")).toBeInTheDocument();
  expect(review.getByText("US$4.33")).toBeInTheDocument();
  expect(review.getByLabelText("Category for Starbucks")).toHaveValue("Dining");
});

test("adding uses the category the user picked", async () => {
  render(<BankImport />);

  await userEvent.selectOptions(await screen.findByLabelText("Category for Starbucks"), "Groceries");
  await userEvent.click(screen.getByRole("button", { name: "Add Starbucks to expenses" }));

  expect(addBankTransaction).toHaveBeenCalledWith(21, "Groceries");
  expect(await screen.findByRole("status")).toHaveTextContent("Starbucks was added to your expenses.");
});

test("adding without changing anything uses the suggestion", async () => {
  render(<BankImport />);

  await userEvent.click(await screen.findByRole("button", { name: "Add Starbucks to expenses" }));

  expect(addBankTransaction).toHaveBeenCalledWith(21, "Dining");
});

test("ignoring a transaction tells the backend", async () => {
  render(<BankImport />);

  await userEvent.click(await screen.findByRole("button", { name: "Ignore Starbucks" }));

  expect(ignoreBankTransaction).toHaveBeenCalledWith(21);
});

test("a bank can be removed", async () => {
  render(<BankImport />);

  await userEvent.click(await screen.findByRole("button", { name: "Remove First Platypus Bank" }));

  expect(removeBankConnection).toHaveBeenCalledWith(4);
});

test("a failure from the bank service is shown", async () => {
  vi.mocked(syncBank).mockRejectedValue(new Error("Could not reach the bank service."));
  render(<BankImport />);

  await userEvent.click(await screen.findByRole("button", { name: "Import transactions" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the bank service.");
});

test("the green card counts what is waiting for review", async () => {
  render(<BankImport />);

  const card = within(await screen.findByRole("region", { name: "Waiting for review" }));
  expect(card.getByText("1")).toBeInTheDocument();
  expect(card.getByText(/transaction from 1 connected bank/)).toBeInTheDocument();
});
