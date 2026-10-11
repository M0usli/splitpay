import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import ExpenseForm from "@/components/ExpenseForm";

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
