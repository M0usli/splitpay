import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import Wallet from "@/components/Wallet";
import {
  getWallet,
  listWalletTransactions,
  sendMoney,
  topUpWallet,
  type TransferResult,
  type WalletTransaction,
} from "@/lib/api";

// No test calls the real backend.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getWallet: vi.fn(),
  listWalletTransactions: vi.fn(),
  sendMoney: vi.fn(),
  topUpWallet: vi.fn(),
}));

const TOP_UP: WalletTransaction = {
  id: 1,
  kind: "top_up",
  direction: "in",
  amount: "100.00",
  counterparty: null,
  note: null,
  created_at: "2026-10-12T09:00:00Z",
};
const SENT: WalletTransaction = {
  id: 2,
  kind: "send",
  direction: "out",
  amount: "30.00",
  counterparty: "alex@example.com",
  note: "Pizza",
  created_at: "2026-10-13T09:00:00Z",
};
const RECEIVED: WalletTransaction = {
  ...SENT,
  id: 3,
  direction: "in",
  amount: "5.50",
  counterparty: "jo@example.com",
  note: null,
};

const RESULT: TransferResult = { transaction: SENT, balance: "70.00" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWallet).mockResolvedValue({ balance: "75.50", currency: "CAD" });
  vi.mocked(listWalletTransactions).mockResolvedValue([RECEIVED, SENT, TOP_UP]);
  vi.mocked(topUpWallet).mockResolvedValue(RESULT);
  vi.mocked(sendMoney).mockResolvedValue(RESULT);
});

async function fillSend(email: string, amount: string, note = "") {
  await userEvent.type(await screen.findByLabelText("To (their email)"), email);
  await userEvent.type(screen.getByLabelText("Amount"), amount);
  if (note !== "") {
    await userEvent.type(screen.getByLabelText(/^Note/), note);
  }
  await userEvent.click(screen.getByRole("button", { name: "Review" }));
}

test("shows the balance and says the money is pretend", async () => {
  render(<Wallet />);

  const balance = within(await screen.findByRole("region", { name: "Balance" }));
  expect(balance.getByText("$75.50")).toBeInTheDocument();
  expect(balance.getByText(/Pretend money/)).toBeInTheDocument();
});

test("the history describes each line from the user's side", async () => {
  render(<Wallet />);

  const history = within(await screen.findByRole("region", { name: "History" }));
  const rows = history.getAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("Received from jo@example.com");
  expect(rows[0]).toHaveTextContent("+$5.50");
  expect(rows[1]).toHaveTextContent("Sent to alex@example.com");
  expect(rows[1]).toHaveTextContent("−$30.00");
  expect(rows[1]).toHaveTextContent("Pizza");
  expect(rows[2]).toHaveTextContent("Top-up");
  expect(rows[2]).toHaveTextContent("+$100.00");
});

test("an empty wallet says how to start", async () => {
  vi.mocked(listWalletTransactions).mockResolvedValue([]);
  render(<Wallet />);

  expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
});

test("a quick button adds that amount with a fresh request id", async () => {
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "+ $50.00" }));

  expect(topUpWallet).toHaveBeenCalledWith("50", expect.stringMatching(/^[0-9a-f]{32}$/));
  expect(await screen.findByRole("status")).toHaveTextContent("$50.00 was added to your wallet.");
  // The page loads the balance again to show the new one.
  expect(getWallet).toHaveBeenCalledTimes(2);
});

test("another amount can be typed in", async () => {
  render(<Wallet />);

  await userEvent.type(await screen.findByLabelText("Another amount"), "12.50");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(topUpWallet).toHaveBeenCalledWith("12.50", expect.any(String));
});

test("a top-up that is not an amount is refused before calling the backend", async () => {
  render(<Wallet />);

  await userEvent.type(await screen.findByLabelText("Another amount"), "abc");
  await userEvent.click(screen.getByRole("button", { name: "Add" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount to add");
  expect(topUpWallet).not.toHaveBeenCalled();
});

test("sending asks for confirmation before any money moves", async () => {
  render(<Wallet />);

  await fillSend("alex@example.com", "30", "Pizza");

  expect(screen.getByText("$30.00")).toBeInTheDocument();
  expect(screen.getByText("alex@example.com")).toBeInTheDocument();
  expect(screen.getByText("Note: Pizza")).toBeInTheDocument();
  expect(sendMoney).not.toHaveBeenCalled();
});

test("confirming sends the money and clears the form", async () => {
  render(<Wallet />);
  await fillSend("alex@example.com", "30", "Pizza");

  await userEvent.click(screen.getByRole("button", { name: "Confirm and send" }));

  expect(sendMoney).toHaveBeenCalledWith(
    expect.objectContaining({ toEmail: "alex@example.com", amount: "30", note: "Pizza" }),
    expect.stringMatching(/^[0-9a-f]{32}$/),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "$30.00 was sent to alex@example.com.",
  );
  expect(screen.getByLabelText("To (their email)")).toHaveValue("");
});

test("going back from the confirm step keeps what was typed and sends nothing", async () => {
  render(<Wallet />);
  await fillSend("alex@example.com", "30");

  await userEvent.click(screen.getByRole("button", { name: "Back" }));

  expect(sendMoney).not.toHaveBeenCalled();
  expect(screen.getByLabelText("To (their email)")).toHaveValue("alex@example.com");
  expect(screen.getByLabelText("Amount")).toHaveValue("30");
});

test("each new send gets its own request id", async () => {
  render(<Wallet />);

  await fillSend("alex@example.com", "30");
  await userEvent.click(screen.getByRole("button", { name: "Confirm and send" }));
  await screen.findByRole("status");
  await fillSend("alex@example.com", "30");
  await userEvent.click(screen.getByRole("button", { name: "Confirm and send" }));
  await screen.findByRole("status");

  const [first, second] = vi.mocked(sendMoney).mock.calls.map((call) => call[1]);
  expect(first).not.toBe(second);
});

test("a refused send shows the reason and keeps the form filled in", async () => {
  vi.mocked(sendMoney).mockRejectedValue(new Error("You do not have enough money in your wallet."));
  render(<Wallet />);
  await fillSend("alex@example.com", "500");

  await userEvent.click(screen.getByRole("button", { name: "Confirm and send" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("You do not have enough money");
  expect(screen.getByLabelText("Amount")).toHaveValue("500");
});

test("a send amount that is not an amount never reaches the confirm step", async () => {
  render(<Wallet />);

  await fillSend("alex@example.com", "lots");

  expect(screen.getByRole("alert")).toHaveTextContent("Enter an amount to send");
  expect(screen.queryByRole("button", { name: "Confirm and send" })).not.toBeInTheDocument();
});
