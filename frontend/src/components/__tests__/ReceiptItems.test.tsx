import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";

import ReceiptItems from "@/components/ReceiptItems";
import type { ExtractedItem } from "@/lib/api";

const ITEMS: ExtractedItem[] = [
  { name: "2% MILK 4L", quantity: null, price: "4.49", is_taxable: false },
  { name: "DISH SOAP", quantity: 2, price: "7.98", is_taxable: true },
  { name: "COUPON", quantity: null, price: "-1.00", is_taxable: null },
];

test("shows one row per item with its price", () => {
  render(<ReceiptItems items={ITEMS} currency="CAD" />);

  expect(screen.getByRole("heading", { name: "Items (3)" })).toBeInTheDocument();
  const rows = screen.getAllByRole("row").slice(1); // skip the header row
  expect(rows).toHaveLength(3);
  expect(within(rows[0]).getByText("2% MILK 4L")).toBeInTheDocument();
  expect(within(rows[0]).getByText("$4.49")).toBeInTheDocument();
});

test("shows the quantity and whether the item was taxed, when known", () => {
  render(<ReceiptItems items={ITEMS} currency="CAD" />);

  const [milk, soap, coupon] = screen.getAllByRole("row").slice(1);
  expect(within(milk).getByText("Not taxed")).toBeInTheDocument();
  expect(within(soap).getByText("2")).toBeInTheDocument();
  expect(within(soap).getByText("Taxed")).toBeInTheDocument();
  // The receipt did not say whether the coupon line was taxed.
  expect(within(coupon).queryByText(/taxed/i)).not.toBeInTheDocument();
});

test("shows a discount as a negative amount", () => {
  render(<ReceiptItems items={ITEMS} currency="CAD" />);

  expect(screen.getByText("-$1.00")).toBeInTheDocument();
});

test("two identical lines both appear", () => {
  const twice = [ITEMS[0], ITEMS[0]];
  render(<ReceiptItems items={twice} currency="CAD" />);

  expect(screen.getAllByText("2% MILK 4L")).toHaveLength(2);
});
