import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import Bills from "@/components/Bills";
import { enterPin } from "@/test/enterPin";
import {
  getPin,
  getWallet,
  listBillers,
  listBillPayments,
  listSavedBillers,
  payBill,
  removeSavedBiller,
  saveBiller,
  type Biller,
  type BillPayment,
  type SavedBiller,
} from "@/lib/api";

// No test calls the real backend.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getPin: vi.fn(),
  getWallet: vi.fn(),
  listBillers: vi.fn(),
  listBillPayments: vi.fn(),
  listSavedBillers: vi.fn(),
  payBill: vi.fn(),
  removeSavedBiller: vi.fn(),
  saveBiller: vi.fn(),
}));

const HYDRO: Biller = { code: "northern-hydro", name: "Northern Hydro", kind: "Electricity" };
const INTERNET: Biller = { code: "maplenet", name: "MapleNet", kind: "Internet" };
const MY_HYDRO: SavedBiller = { id: 3, biller: HYDRO, account_number: "AB-1234" };
const RECEIPT: BillPayment = {
  id: 42,
  reference: "BP-000042",
  biller: HYDRO,
  account_number: "AB-1234",
  amount: "64.20",
  currency: "CAD",
  created_at: "2026-10-13T09:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getWallet).mockResolvedValue({ balance: "100.00", currency: "CAD" });
  vi.mocked(listBillers).mockResolvedValue([HYDRO, INTERNET]);
  vi.mocked(listSavedBillers).mockResolvedValue([MY_HYDRO]);
  vi.mocked(listBillPayments).mockResolvedValue([]);
  vi.mocked(saveBiller).mockResolvedValue(MY_HYDRO);
  vi.mocked(payBill).mockResolvedValue(RECEIPT);
  // The user has a payment PIN, and it is not locked.
  vi.mocked(getPin).mockResolvedValue({ is_set: true, locked_minutes: 0 });
});

const click = (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));

// --- the start screen ---

test("shows the wallet balance and the saved billers", async () => {
  render(<Bills />);

  const billers = within(await screen.findByRole("region", { name: "Your billers" }));
  expect(billers.getByText("Northern Hydro")).toBeInTheDocument();
  expect(billers.getByText("Electricity · AB-1234")).toBeInTheDocument();
  expect(screen.getByText("$100.00")).toBeInTheDocument();
});

test("with no billers and no receipts it says what to do", async () => {
  vi.mocked(listSavedBillers).mockResolvedValue([]);
  render(<Bills />);

  expect(await screen.findByText(/No billers yet/)).toBeInTheDocument();
  expect(screen.getByText("Bills you pay will be listed here.")).toBeInTheDocument();
});

test("says so when the page cannot be loaded", async () => {
  vi.mocked(listSavedBillers).mockRejectedValue(new Error("Could not reach the backend."));
  render(<Bills />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the backend.");
});

// --- adding and removing a biller ---

test("adding a biller: pick the company, type the account number, save", async () => {
  render(<Bills />);

  await userEvent.click(await screen.findByRole("button", { name: "+ Add a biller" }));
  await click(/MapleNet/);
  await userEvent.type(screen.getByLabelText("Account number"), "9988-77");
  await click("Save biller");

  expect(saveBiller).toHaveBeenCalledWith("maplenet", "9988-77");
  expect(await screen.findByRole("status")).toHaveTextContent("MapleNet was saved.");
});

test("a biller that cannot be saved says why and stays on the step", async () => {
  vi.mocked(saveBiller).mockRejectedValue(new Error("You can save at most 20 billers"));
  render(<Bills />);

  await userEvent.click(await screen.findByRole("button", { name: "+ Add a biller" }));
  await click(/MapleNet/);
  await userEvent.type(screen.getByLabelText("Account number"), "9988-77");
  await click("Save biller");

  expect(await screen.findByRole("alert")).toHaveTextContent("You can save at most 20 billers");
  expect(screen.getByLabelText("Account number")).toBeInTheDocument();
});

test("a saved biller can be removed", async () => {
  render(<Bills />);

  await userEvent.click(
    await screen.findByRole("button", { name: "Remove Northern Hydro AB-1234" }),
  );

  expect(removeSavedBiller).toHaveBeenCalledWith(3);
  expect(await screen.findByRole("status")).toHaveTextContent("Northern Hydro was removed.");
});

// --- paying ---

/** From the start: Pay on the saved biller, then $50 and Review. Leaves the confirm step open. */
async function reviewFiftyDollars() {
  await userEvent.click(await screen.findByRole("button", { name: "Pay Northern Hydro AB-1234" }));
  await click("$50");
  await click("Review");
}

test("nothing is paid before Confirm", async () => {
  render(<Bills />);

  await reviewFiftyDollars();

  const confirm = within(screen.getByRole("region", { name: "Confirm" }));
  expect(confirm.getByText("$50.00")).toBeInTheDocument();
  expect(confirm.getByText("Northern Hydro")).toBeInTheDocument();
  expect(confirm.getByText("Account AB-1234")).toBeInTheDocument();
  expect(payBill).not.toHaveBeenCalled();
});

test("Review stays off until there is an amount", async () => {
  render(<Bills />);

  await userEvent.click(await screen.findByRole("button", { name: "Pay Northern Hydro AB-1234" }));

  expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
});

test("confirming pays the bill and shows its receipt", async () => {
  render(<Bills />);

  await reviewFiftyDollars();
  await click("Confirm and pay");
  await enterPin();

  expect(payBill).toHaveBeenCalledWith(3, "50", expect.stringMatching(/^[0-9a-f]{32}$/), "4826");
  const receipt = within(await screen.findByRole("region", { name: "Receipt" }));
  expect(receipt.getByRole("status")).toHaveTextContent("Bill paid");
  expect(receipt.getByText("BP-000042")).toBeInTheDocument();
  expect(receipt.getByText("$64.20")).toBeInTheDocument();

  await click("Done");
  expect(screen.getByRole("region", { name: "Your billers" })).toBeInTheDocument();
});

test("a payment that fails and is tried again uses the same request id", async () => {
  vi.mocked(payBill).mockRejectedValueOnce(new Error("Could not reach the backend."));
  render(<Bills />);

  await reviewFiftyDollars();
  await click("Confirm and pay");
  await enterPin();
  await screen.findByRole("alert");
  await enterPin();
  await screen.findByRole("region", { name: "Receipt" });

  const [first, second] = vi.mocked(payBill).mock.calls.map((call) => call[2]);
  expect(first).toBe(second);
});

test("not enough money shows the reason and a link to the wallet", async () => {
  vi.mocked(payBill).mockRejectedValue(new Error("You do not have enough money in your wallet."));
  render(<Bills />);

  await reviewFiftyDollars();
  await click("Confirm and pay");
  await enterPin();

  expect(await screen.findByRole("alert")).toHaveTextContent("You do not have enough money");
  expect(screen.getByRole("link", { name: "Add money to your wallet" })).toHaveAttribute("href", "/");
});

// --- receipts ---

test("past payments are listed and open as receipts", async () => {
  vi.mocked(listBillPayments).mockResolvedValue([RECEIPT]);
  render(<Bills />);

  const receipts = within(await screen.findByRole("region", { name: "Receipts" }));
  expect(receipts.getByText("−$64.20")).toBeInTheDocument();
  await userEvent.click(receipts.getByRole("button", { name: "Receipt BP-000042" }));

  const receipt = within(screen.getByRole("region", { name: "Receipt" }));
  expect(receipt.getByText("Electricity")).toBeInTheDocument();
  expect(receipt.getByText("2026-10-13")).toBeInTheDocument();
  // An old receipt has a Back button, not the "Bill paid" message.
  expect(receipt.queryByRole("status")).not.toBeInTheDocument();
  expect(receipt.getByRole("button", { name: "Back" })).toBeInTheDocument();
});
