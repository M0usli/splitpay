import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import SplitBill from "@/components/SplitBill";
import {
  createHousehold,
  getBalance,
  getHousehold,
  joinHousehold,
  listSettlements,
  listSharedExpenses,
  recordSettlement,
  type Balance,
  type Household,
} from "@/lib/api";

// The logged-in user is Sam (id 1). No test calls the real backend.
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({
    auth: { state: "signedIn", user: { id: 1, email: "sam@example.com", created_at: "" } },
  }),
}));
vi.mock("@/lib/api", () => ({
  createHousehold: vi.fn(),
  deleteSettlement: vi.fn(),
  getBalance: vi.fn(),
  getHousehold: vi.fn(),
  joinHousehold: vi.fn(),
  leaveHousehold: vi.fn(),
  listSettlements: vi.fn(),
  listSharedExpenses: vi.fn(),
  recordSettlement: vi.fn(),
}));

const SAM = { id: 1, email: "sam@example.com" };
const ALEX = { id: 2, email: "alex@example.com" };

const HOUSEHOLD: Household = {
  id: 7,
  name: "Apartment 4B",
  invite_code: "AF6S4JQ8",
  members: [SAM, ALEX],
};

/** Sam owes Alex 30.00. */
const SAM_OWES: Balance = {
  currency: "CAD",
  shared_expense_count: 1,
  members: [
    { member: SAM, net: "-30.00" },
    { member: ALEX, net: "30.00" },
  ],
  payments: [{ owed_by: SAM, owed_to: ALEX, amount: "30.00" }],
};

const SETTLED: Balance = {
  ...SAM_OWES,
  members: [
    { member: SAM, net: "0.00" },
    { member: ALEX, net: "0.00" },
  ],
  payments: [],
};

function mockHousehold(balance: Balance) {
  vi.mocked(getHousehold).mockResolvedValue(HOUSEHOLD);
  vi.mocked(getBalance).mockResolvedValue(balance);
  vi.mocked(listSharedExpenses).mockResolvedValue([]);
  vi.mocked(listSettlements).mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("someone without a household can create one", async () => {
  vi.mocked(getHousehold).mockResolvedValue(null);
  vi.mocked(createHousehold).mockResolvedValue(HOUSEHOLD);
  render(<SplitBill />);

  await userEvent.type(await screen.findByLabelText("Household name"), "Apartment 4B");
  await userEvent.click(screen.getByRole("button", { name: "Create" }));

  expect(createHousehold).toHaveBeenCalledWith("Apartment 4B");
});

test("someone without a household can join one with a code", async () => {
  vi.mocked(getHousehold).mockResolvedValue(null);
  vi.mocked(joinHousehold).mockResolvedValue(HOUSEHOLD);
  render(<SplitBill />);

  await userEvent.type(await screen.findByLabelText("Invite code"), "af6s4jq8");
  await userEvent.click(screen.getByRole("button", { name: "Join" }));

  expect(joinHousehold).toHaveBeenCalledWith("af6s4jq8");
});

test("a wrong invite code shows the backend's message", async () => {
  vi.mocked(getHousehold).mockResolvedValue(null);
  vi.mocked(joinHousehold).mockRejectedValue(new Error("No household has this invite code"));
  render(<SplitBill />);

  await userEvent.type(await screen.findByLabelText("Invite code"), "WRONG");
  await userEvent.click(screen.getByRole("button", { name: "Join" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("No household has this invite code");
});

test("shows the household, its code and where each member stands", async () => {
  mockHousehold(SAM_OWES);
  render(<SplitBill />);

  expect(await screen.findByRole("heading", { name: "Apartment 4B" })).toBeInTheDocument();
  expect(screen.getByText("AF6S4JQ8")).toBeInTheDocument();
  expect(screen.getByText("You owe $30.00 in total.")).toBeInTheDocument();
  const members = within(screen.getByRole("region", { name: "Apartment 4B" }));
  expect(members.getByText("owes $30.00")).toBeInTheDocument();
  expect(members.getByText("is owed $30.00")).toBeInTheDocument();
});

test("the person who owes can record that they paid", async () => {
  mockHousehold(SAM_OWES);
  render(<SplitBill />);

  await userEvent.click(await screen.findByRole("button", { name: "I paid this" }));

  expect(recordSettlement).toHaveBeenCalledWith(2, "30.00");
  // The page loads its data again to show the new balance.
  expect(getBalance).toHaveBeenCalledTimes(2);
});

test("someone who is owed money gets no pay button", async () => {
  mockHousehold({
    ...SAM_OWES,
    members: [
      { member: SAM, net: "30.00" },
      { member: ALEX, net: "-30.00" },
    ],
    payments: [{ owed_by: ALEX, owed_to: SAM, amount: "30.00" }],
  });
  render(<SplitBill />);

  expect(await screen.findByText("You are owed $30.00 in total.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "I paid this" })).not.toBeInTheDocument();
});

test("says so when everyone is settled up", async () => {
  mockHousehold(SETTLED);
  render(<SplitBill />);

  expect(await screen.findByText("Everyone is settled up.")).toBeInTheDocument();
  expect(screen.getByText("You are settled up.")).toBeInTheDocument();
});
