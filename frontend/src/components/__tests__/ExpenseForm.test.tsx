import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import ExpenseForm from "@/components/ExpenseForm";
import type { HouseholdInfo } from "@/components/useHousehold";

// The form asks useHousehold who the user lives with. Most tests leave it at
// null (no household); the sharing tests at the end set one.
const household = vi.hoisted(() => ({ info: null as HouseholdInfo | null }));
vi.mock("@/components/useHousehold", () => ({ useHousehold: () => household.info }));
// The item split's summary asks the backend. Here it never answers, so these
// tests stay about the form itself (the summary has its own tests).
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  previewItemSplit: vi.fn(() => new Promise(() => {})),
}));

const WITH_ROOMMATE: HouseholdInfo = {
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

async function fillRequiredFields(total: string) {
  await userEvent.type(screen.getByLabelText("Merchant"), "FreshCo");
  await userEvent.type(screen.getByLabelText("Date"), "2026-10-08");
  await userEvent.selectOptions(screen.getByLabelText("Category"), "Groceries");
  await userEvent.type(screen.getByLabelText("Total"), total);
}

beforeEach(() => {
  household.info = null;
});

test("offers no sharing to someone without a household", () => {
  render(<ExpenseForm submitLabel="Save" onSubmit={vi.fn()} />);

  expect(screen.queryByLabelText("Share this expense with my household")).not.toBeInTheDocument();
});

test("a shared expense split equally among everyone sends no parts", async () => {
  household.info = WITH_ROOMMATE;
  const onSubmit = vi.fn(() => Promise.resolve());
  render(<ExpenseForm submitLabel="Save" onSubmit={onSubmit} />);

  await fillRequiredFields("87.40");
  await userEvent.click(screen.getByLabelText("Share this expense with my household"));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ is_shared: true, shares: null }));
});

test("amounts that do not add up stop the form and say why", async () => {
  household.info = WITH_ROOMMATE;
  const onSubmit = vi.fn(() => Promise.resolve());
  render(<ExpenseForm submitLabel="Save" onSubmit={onSubmit} />);

  await fillRequiredFields("87.40");
  await userEvent.click(screen.getByLabelText("Share this expense with my household"));
  await userEvent.click(screen.getByLabelText("By amount"));
  await userEvent.type(screen.getByLabelText("Amount for Me (sam@example.com)"), "50");
  await userEvent.type(screen.getByLabelText("Amount for alex@example.com"), "30");
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(screen.getByRole("alert")).toHaveTextContent(
    "The amounts add up to 80.00, but the total is 87.40.",
  );
  expect(onSubmit).not.toHaveBeenCalled();
});

test("submits what the user typed, with empty optional fields sent as null", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(() => Promise.resolve());
  render(<ExpenseForm submitLabel="Add expense" onSubmit={onSubmit} />);

  await user.type(screen.getByLabelText("Merchant"), "  Tim Hortons ");
  await user.type(screen.getByLabelText("Date"), "2026-10-03");
  await user.selectOptions(screen.getByLabelText("Category"), "Dining");
  await user.type(screen.getByLabelText("Total"), "6.64");
  await user.click(screen.getByRole("button", { name: "Add expense" }));

  expect(onSubmit).toHaveBeenCalledWith({
    merchant: "Tim Hortons",
    date: "2026-10-03",
    subtotal: null,
    tax: null,
    total: "6.64",
    currency: "CAD",
    category: "Dining",
    notes: null,
    is_shared: false,
    shares: null,
    split_items: null,
  });
});

test("starts with the values it is given, such as what the AI read", () => {
  render(
    <ExpenseForm
      submitLabel="Save expense"
      initialValues={{ merchant: "FreshCo", total: "38.47", category: "Groceries" }}
      onSubmit={() => Promise.resolve()}
    />,
  );

  expect(screen.getByLabelText("Merchant")).toHaveValue("FreshCo");
  expect(screen.getByLabelText("Total")).toHaveValue(38.47);
  expect(screen.getByLabelText("Category")).toHaveValue("Groceries");
  // A field the AI did not find starts empty.
  expect(screen.getByLabelText("Date")).toHaveValue("");
});

test("shows the error and lets the user try again when saving fails", async () => {
  const user = userEvent.setup();
  const onSubmit = vi.fn(() => Promise.reject(new Error("Could not reach the backend.")));
  render(
    <ExpenseForm
      submitLabel="Save"
      initialValues={{
        merchant: "FreshCo",
        date: "2026-10-08",
        total: "38.47",
        category: "Groceries",
      }}
      onSubmit={onSubmit}
    />,
  );

  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the backend.");
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

test("a receipt split by item sends the items and lets the server work out the parts", async () => {
  household.info = WITH_ROOMMATE;
  const onSubmit = vi.fn(() => Promise.resolve());
  render(
    <ExpenseForm
      submitLabel="Save"
      onSubmit={onSubmit}
      initialItems={[
        { name: "MILK", quantity: null, price: "6.49", is_taxable: false },
        { name: "DISH SOAP", quantity: null, price: "3.49", is_taxable: true },
      ]}
    />,
  );

  await fillRequiredFields("10.43");
  await userEvent.click(screen.getByLabelText("Share this expense with my household"));
  await userEvent.click(screen.getByLabelText("By item"));
  // The soap is only the roommate's.
  await userEvent.click(screen.getByLabelText("Me shares item 2"));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({
      is_shared: true,
      shares: null,
      split_items: [
        { name: "MILK", price: "6.49", is_taxable: false, shared_by: [1, 2] },
        { name: "DISH SOAP", price: "3.49", is_taxable: true, shared_by: [2] },
      ],
    }),
  );
});

test("an item with nobody chosen stops the form and says which item", async () => {
  household.info = WITH_ROOMMATE;
  const onSubmit = vi.fn(() => Promise.resolve());
  render(
    <ExpenseForm
      submitLabel="Save"
      onSubmit={onSubmit}
      initialItems={[{ name: "MILK", quantity: null, price: "6.49", is_taxable: false }]}
    />,
  );

  await fillRequiredFields("6.49");
  await userEvent.click(screen.getByLabelText("Share this expense with my household"));
  await userEvent.click(screen.getByLabelText("By item"));
  await userEvent.click(screen.getByLabelText("Me shares item 1"));
  await userEvent.click(screen.getByLabelText("alex shares item 1"));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(screen.getByRole("alert")).toHaveTextContent('Choose who "MILK" is for.');
  expect(onSubmit).not.toHaveBeenCalled();
});

test("a saved item split reopens with the same people ticked", () => {
  household.info = WITH_ROOMMATE;
  render(
    <ExpenseForm
      submitLabel="Save"
      onSubmit={vi.fn()}
      initialValues={{
        total: "6.49",
        is_shared: true,
        shares: [{ user_id: 2, amount: "6.49" }],
        split_items: [{ name: "MILK", price: "6.49", is_taxable: false, shared_by: [2] }],
      }}
    />,
  );

  expect(screen.getByLabelText("By item")).toBeChecked();
  expect(screen.getByLabelText("Name of item 1")).toHaveValue("MILK");
  expect(screen.getByLabelText("Me shares item 1")).not.toBeChecked();
  expect(screen.getByLabelText("alex shares item 1")).toBeChecked();
});

test("sharing a receipt that has items goes straight to choosing who each item is for", async () => {
  household.info = WITH_ROOMMATE;
  render(
    <ExpenseForm
      submitLabel="Save"
      onSubmit={vi.fn()}
      initialItems={[{ name: "MILK", quantity: null, price: "6.49", is_taxable: false }]}
    />,
  );

  await userEvent.click(screen.getByLabelText("Share this expense with my household"));

  expect(screen.getByLabelText("By item")).toBeChecked();
  expect(screen.getByLabelText("Name of item 1")).toHaveValue("MILK");
  expect(screen.getByLabelText("Me shares item 1")).toBeChecked();
  expect(screen.getByLabelText("alex shares item 1")).toBeChecked();
});

test("sharing an expense without items still starts with an equal split", async () => {
  household.info = WITH_ROOMMATE;
  render(<ExpenseForm submitLabel="Save" onSubmit={vi.fn()} />);

  await userEvent.click(screen.getByLabelText("Share this expense with my household"));

  expect(screen.getByLabelText("Equally")).toBeChecked();
});
