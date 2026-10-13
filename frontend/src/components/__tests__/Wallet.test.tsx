import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import Wallet from "@/components/Wallet";
import {
  getHousehold,
  getWallet,
  listWalletTransactions,
  sendMoney,
  topUpWallet,
  type TransferResult,
  type WalletTransaction,
} from "@/lib/api";

// The logged-in user is Sam. No test calls the real backend.
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({
    auth: { state: "signedIn", user: { id: 1, email: "sam@example.com", created_at: "" } },
  }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getHousehold: vi.fn(),
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
  // Sam lives with Kim, who is not in the history yet.
  vi.mocked(getHousehold).mockResolvedValue({
    id: 7,
    name: "Apartment 4B",
    invite_code: "AF6S4JQ8",
    members: [
      { id: 1, email: "sam@example.com" },
      { id: 4, email: "kim@example.com" },
    ],
  });
  vi.mocked(topUpWallet).mockResolvedValue(RESULT);
  vi.mocked(sendMoney).mockResolvedValue(RESULT);
});

const click = (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));

/** From the start: Send, pick Alex, tap $20. Leaves the "How much?" step open. */
async function startSendingToAlex() {
  await userEvent.click(await screen.findByRole("button", { name: "Send" }));
  await click("Send to alex@example.com");
  await click("$20");
}

// --- the start screen ---

test("shows the balance and says the money is pretend", async () => {
  render(<Wallet />);

  const balance = within(await screen.findByRole("region", { name: "Balance" }));
  expect(balance.getByText("$75.50")).toBeInTheDocument();
  expect(balance.getByText(/Pretend money/)).toBeInTheDocument();
});

test("the history describes each line from the user's side", async () => {
  render(<Wallet />);

  const rows = within(await screen.findByRole("region", { name: "History" })).getAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("Received from jo");
  expect(rows[0]).toHaveTextContent("+$5.50");
  expect(rows[1]).toHaveTextContent("Sent to alex");
  expect(rows[1]).toHaveTextContent("−$30.00");
  expect(rows[1]).toHaveTextContent("Pizza");
  expect(rows[2]).toHaveTextContent("Added money");
});

test("offers housemates and people from the history as one-tap buttons, each once", async () => {
  render(<Wallet />);

  const quick = within(await screen.findByRole("region", { name: "Send again" }));
  const names = quick.getAllByRole("button").map((button) => button.getAttribute("aria-label"));
  // The housemate first, then the history, newest first. Sam is never offered to Sam.
  expect(names).toEqual([
    "Send to kim@example.com",
    "Send to jo@example.com",
    "Send to alex@example.com",
  ]);
});

test("the wallet still works when the household cannot be loaded", async () => {
  vi.mocked(getHousehold).mockRejectedValue(new Error("Could not reach the backend."));
  render(<Wallet />);

  expect(await screen.findByText("$75.50")).toBeInTheDocument();
});

// --- adding money ---

test("adding money takes two taps: an amount and the button", async () => {
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "Add money" }));
  await click("$50");
  await click("Add $50.00");

  expect(topUpWallet).toHaveBeenCalledWith("50", expect.stringMatching(/^[0-9a-f]{32}$/));
  expect(await screen.findByRole("status")).toHaveTextContent("$50.00 was added to your wallet.");
  // Back on the start screen, with the balance loaded again.
  expect(screen.getByRole("region", { name: "Balance" })).toBeInTheDocument();
  expect(getWallet).toHaveBeenCalledTimes(2);
});

test("the number pad builds any amount without typing", async () => {
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "Add money" }));
  for (const key of ["1", "2", "Point", "5"]) {
    await click(key);
  }

  expect(screen.getByTestId("amount")).toHaveTextContent("12.5");
  await click("Add $12.50");
  expect(topUpWallet).toHaveBeenCalledWith("12.5", expect.any(String));
});

test("the add button is off until there is an amount above zero", async () => {
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "Add money" }));

  const add = screen.getAllByRole("button", { name: "Add money" }).at(-1);
  expect(add).toBeDisabled();
  await click("0");
  expect(add).toBeDisabled();
  await click("7");
  expect(screen.getByRole("button", { name: "Add $7.00" })).toBeEnabled();
});

test("Erase removes the last key pressed", async () => {
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "Add money" }));
  await click("4");
  await click("2");
  await click("Erase");

  expect(screen.getByTestId("amount")).toHaveTextContent("4");
});

// --- sending money ---

test("sending to a known person needs no typing at all", async () => {
  render(<Wallet />);

  await startSendingToAlex();
  await click("Groceries");
  await click("Review");
  await click("Confirm and send");

  expect(sendMoney).toHaveBeenCalledWith(
    expect.objectContaining({ toEmail: "alex@example.com", amount: "20", note: "Groceries" }),
    expect.stringMatching(/^[0-9a-f]{32}$/),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "$20.00 was sent to alex@example.com.",
  );
});

test("nothing is sent before the confirm button is pressed", async () => {
  render(<Wallet />);

  await startSendingToAlex();
  await click("Review");

  const confirm = within(screen.getByRole("region", { name: "Confirm" }));
  expect(confirm.getByText("$20.00")).toBeInTheDocument();
  expect(confirm.getByText("alex@example.com")).toBeInTheDocument();
  expect(sendMoney).not.toHaveBeenCalled();
});

test("a person on the start screen skips the choosing step", async () => {
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "Send to kim@example.com" }));

  expect(screen.getByRole("heading", { name: "How much?" })).toBeInTheDocument();
  expect(screen.getByText("kim@example.com")).toBeInTheDocument();
});

test("someone new can be reached by typing their email once", async () => {
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "Send" }));
  await click("+ Someone else");
  await userEvent.type(screen.getByLabelText("Their email"), "  New.Person@Example.com ");
  await click("Continue");

  expect(screen.getByText("new.person@example.com")).toBeInTheDocument();
});

test("a note chip can be chosen and taken back", async () => {
  render(<Wallet />);
  await startSendingToAlex();

  await click("Rent");
  expect(screen.getByRole("button", { name: "Rent" })).toHaveAttribute("aria-pressed", "true");
  await click("Rent");
  await click("Review");
  await click("Confirm and send");

  expect(sendMoney).toHaveBeenCalledWith(expect.objectContaining({ note: null }), expect.any(String));
});

test("Review is off until there is an amount", async () => {
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "Send" }));
  await click("Send to alex@example.com");

  expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
});

test("Back goes one step back each time", async () => {
  render(<Wallet />);
  await startSendingToAlex();
  await click("Review");

  await click("Back");
  expect(screen.getByRole("heading", { name: "How much?" })).toBeInTheDocument();
  await click("Back");
  expect(screen.getByRole("heading", { name: "Who are you sending to?" })).toBeInTheDocument();
  await click("Back");
  expect(screen.getByRole("region", { name: "Balance" })).toBeInTheDocument();
  expect(sendMoney).not.toHaveBeenCalled();
});

test("a refused send shows the reason and can be retried with the same request id", async () => {
  vi.mocked(sendMoney).mockRejectedValueOnce(new Error("Could not reach the backend."));
  render(<Wallet />);
  await startSendingToAlex();
  await click("Review");

  await click("Confirm and send");
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the backend.");
  await click("Confirm and send");
  await screen.findByRole("status");

  // The retry is the same action, so it carries the same id and cannot send twice.
  const [first, second] = vi.mocked(sendMoney).mock.calls.map((call) => call[1]);
  expect(first).toBe(second);
});

test("each new send gets its own request id", async () => {
  render(<Wallet />);

  for (let round = 0; round < 2; round++) {
    await startSendingToAlex();
    await click("Review");
    await click("Confirm and send");
    await screen.findByRole("status");
  }

  const [first, second] = vi.mocked(sendMoney).mock.calls.map((call) => call[1]);
  expect(first).not.toBe(second);
});
