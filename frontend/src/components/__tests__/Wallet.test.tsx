import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import Wallet from "@/components/Wallet";
import {
  cancelMoneyRequest,
  declineMoneyRequest,
  getBalance,
  getHousehold,
  getWallet,
  listMoneyRequests,
  listWalletTransactions,
  payFromWallet,
  payMoneyRequest,
  requestMoney,
  sendMoney,
  topUpWallet,
  type MoneyRequest,
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
  cancelMoneyRequest: vi.fn(),
  declineMoneyRequest: vi.fn(),
  getBalance: vi.fn(),
  getHousehold: vi.fn(),
  getWallet: vi.fn(),
  listMoneyRequests: vi.fn(),
  listWalletTransactions: vi.fn(),
  payFromWallet: vi.fn(),
  payMoneyRequest: vi.fn(),
  requestMoney: vi.fn(),
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
  // Nobody owes anything unless a test says so.
  vi.mocked(getBalance).mockResolvedValue({
    currency: "CAD",
    shared_expense_count: 0,
    members: [],
    payments: [],
  });
  // No requests are waiting unless a test says so.
  vi.mocked(listMoneyRequests).mockResolvedValue([]);
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

// --- paying what is owed from split bills ---

/** Sam owes Kim 13.18 from a split bill; Kim owes Sam nothing. */
function samOwesKim() {
  const sam = { id: 1, email: "sam@example.com" };
  const kim = { id: 4, email: "kim@example.com" };
  vi.mocked(getBalance).mockResolvedValue({
    currency: "CAD",
    shared_expense_count: 1,
    members: [],
    payments: [{ owed_by: sam, owed_to: kim, amount: "13.18" }],
  });
}

test("shows exactly what is owed from split bills, on a pay button", async () => {
  samOwesKim();
  render(<Wallet />);

  const owe = within(await screen.findByRole("region", { name: "You owe, from split bills" }));
  expect(owe.getByText("kim@example.com")).toBeInTheDocument();
  expect(owe.getByRole("button", { name: "Pay $13.18" })).toBeInTheDocument();
});

test("one tap pays the debt from the wallet", async () => {
  samOwesKim();
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "Pay $13.18" }));

  expect(payFromWallet).toHaveBeenCalledWith(4, "13.18", expect.stringMatching(/^[0-9a-f]{32}$/));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "You paid kim@example.com $13.18 for your split bill.",
  );
});

test("nothing is shown when the user owes nothing, or is the one owed", async () => {
  const sam = { id: 1, email: "sam@example.com" };
  const kim = { id: 4, email: "kim@example.com" };
  vi.mocked(getBalance).mockResolvedValue({
    currency: "CAD",
    shared_expense_count: 1,
    members: [],
    payments: [{ owed_by: kim, owed_to: sam, amount: "13.18" }],
  });
  render(<Wallet />);

  await screen.findByRole("region", { name: "Balance" });
  expect(screen.queryByRole("region", { name: "You owe, from split bills" })).not.toBeInTheDocument();
});

test("a debt that cannot be paid says why", async () => {
  samOwesKim();
  vi.mocked(payFromWallet).mockRejectedValue(
    new Error("You do not have enough money in your wallet."),
  );
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "Pay $13.18" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("You do not have enough money");
});

test("split-bill payments are described as such in the history", async () => {
  vi.mocked(listWalletTransactions).mockResolvedValue([
    { ...SENT, id: 8, kind: "settlement", note: "Split bill" },
    { ...RECEIVED, id: 9, kind: "settlement", note: "Split bill" },
  ]);
  render(<Wallet />);

  const rows = within(await screen.findByRole("region", { name: "History" })).getAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("Paid alex for split bill");
  expect(rows[1]).toHaveTextContent("jo paid you for split bill");
});

// --- requesting money ---

/** Alex asked Sam for 12.00. */
const FROM_ALEX: MoneyRequest = {
  id: 5,
  direction: "incoming",
  counterparty: "alex@example.com",
  amount: "12.00",
  note: "Food",
  status: "pending",
  created_at: "2026-10-13T09:00:00Z",
};
/** Sam asked Kim for 40.00. */
const TO_KIM: MoneyRequest = {
  ...FROM_ALEX,
  id: 6,
  direction: "outgoing",
  counterparty: "kim@example.com",
  amount: "40.00",
  note: "Rent",
};

test("asking for money takes a person, an amount and one tap", async () => {
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "Request" }));
  await click("Request from alex@example.com");
  await click("$20");
  await click("Food");
  await click("Request $20.00");

  expect(requestMoney).toHaveBeenCalledWith({
    toEmail: "alex@example.com",
    amount: "20",
    note: "Food",
  });
  expect(sendMoney).not.toHaveBeenCalled();
  expect(await screen.findByRole("status")).toHaveTextContent(
    "You asked alex@example.com for $20.00.",
  );
});

test("a request that cannot be made says why and stays on the step", async () => {
  vi.mocked(requestMoney).mockRejectedValue(new Error("No account has this email"));
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "Request" }));
  await click("Request from alex@example.com");
  await click("$5");
  await click("Request $5.00");

  expect(await screen.findByRole("alert")).toHaveTextContent("No account has this email");
  expect(screen.getByRole("region", { name: "Request money" })).toBeInTheDocument();
});

test("a request someone sent can be paid with one tap", async () => {
  vi.mocked(listMoneyRequests).mockResolvedValue([FROM_ALEX]);
  render(<Wallet />);

  const forMe = within(await screen.findByRole("region", { name: "Requests for you" }));
  expect(forMe.getByText(/alex asks for \$12\.00/)).toBeInTheDocument();
  await userEvent.click(forMe.getByRole("button", { name: "Pay $12.00" }));

  expect(payMoneyRequest).toHaveBeenCalledWith(5, expect.stringMatching(/^[0-9a-f]{32}$/));
  expect(await screen.findByRole("status")).toHaveTextContent("You paid alex@example.com $12.00.");
});

test("a request someone sent can be declined", async () => {
  vi.mocked(listMoneyRequests).mockResolvedValue([FROM_ALEX]);
  render(<Wallet />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Decline the request from alex@example.com" }),
  );

  expect(declineMoneyRequest).toHaveBeenCalledWith(5);
  expect(payMoneyRequest).not.toHaveBeenCalled();
});

test("a request the user made is shown as waiting and can be cancelled", async () => {
  vi.mocked(listMoneyRequests).mockResolvedValue([TO_KIM]);
  render(<Wallet />);

  const asked = within(await screen.findByRole("region", { name: "You asked for" }));
  expect(asked.getByText("$40.00 from kim")).toBeInTheDocument();
  // The user cannot pay their own request.
  expect(asked.queryByRole("button", { name: /Pay/ })).not.toBeInTheDocument();
  await userEvent.click(asked.getByRole("button", { name: "Cancel the request to kim@example.com" }));

  expect(cancelMoneyRequest).toHaveBeenCalledWith(6);
});

test("finished requests are not listed", async () => {
  vi.mocked(listMoneyRequests).mockResolvedValue([
    { ...FROM_ALEX, status: "declined" },
    { ...TO_KIM, status: "paid" },
  ]);
  render(<Wallet />);

  await screen.findByRole("region", { name: "Balance" });
  expect(screen.queryByRole("region", { name: "Requests for you" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "You asked for" })).not.toBeInTheDocument();
});

test("paid requests are described as such in the history", async () => {
  vi.mocked(listWalletTransactions).mockResolvedValue([
    { ...SENT, id: 8, kind: "request" },
    { ...RECEIVED, id: 9, kind: "request" },
  ]);
  render(<Wallet />);

  const rows = within(await screen.findByRole("region", { name: "History" })).getAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("Paid alex's request");
  expect(rows[1]).toHaveTextContent("jo paid your request");
});

// --- QR code pay ---

test("my code shows a link that pays the user, for any amount", async () => {
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "My code" }));

  const code = within(screen.getByRole("region", { name: "My code" }));
  expect(code.getByTitle("Code to pay sam@example.com")).toBeInTheDocument();
  expect(code.getByText("http://localhost:3000/?pay=sam%40example.com")).toBeInTheDocument();
  expect(code.getByText(/any amount/)).toBeInTheDocument();
  // The test browser is on localhost, which a phone cannot open.
  expect(code.getByText(/only works on this computer/)).toBeInTheDocument();
});

test("my code can ask for a fixed amount", async () => {
  render(<Wallet />);

  await userEvent.click(await screen.findByRole("button", { name: "My code" }));
  await click("Set an amount");
  await click("$20");

  expect(
    screen.getByText("http://localhost:3000/?pay=sam%40example.com&amount=20"),
  ).toBeInTheDocument();
});

test("a scanned code with an amount opens the confirm step, and nothing is sent yet", async () => {
  render(<Wallet payLink={{ toEmail: "alex@example.com", amount: "12.50" }} />);

  const confirm = within(await screen.findByRole("region", { name: "Confirm" }));
  expect(confirm.getByText("$12.50")).toBeInTheDocument();
  expect(confirm.getByText("alex@example.com")).toBeInTheDocument();
  expect(sendMoney).not.toHaveBeenCalled();

  await click("Confirm and send");

  expect(sendMoney).toHaveBeenCalledWith(
    expect.objectContaining({ toEmail: "alex@example.com", amount: "12.50", note: null }),
    expect.stringMatching(/^[0-9a-f]{32}$/),
  );
});

test("a scanned code without an amount asks how much", async () => {
  render(<Wallet payLink={{ toEmail: "alex@example.com", amount: null }} />);

  const step = within(await screen.findByRole("region", { name: "Send money" }));
  expect(step.getByText("How much?")).toBeInTheDocument();
  expect(step.getByText("alex@example.com")).toBeInTheDocument();
});

test("scanning your own code explains that it cannot be paid", async () => {
  render(<Wallet payLink={{ toEmail: "sam@example.com", amount: "5" }} />);

  expect(await screen.findByText("This is your own code")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Confirm and send" })).not.toBeInTheDocument();
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
