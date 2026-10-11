import { expect, test } from "vitest";

import type { ExtractedItem } from "@/lib/api";
import {
  canSplitRow,
  emptyRow,
  rowsFromExtracted,
  rowsFromSaved,
  splitRow,
  toSplitItems,
  type ItemRow,
} from "@/lib/itemSplit";

const MEMBERS = [1, 2, 3];

const EXTRACTED: ExtractedItem[] = [
  { name: "2% MILK 4L", quantity: null, price: "6.49", is_taxable: false },
  { name: "YOGURT", quantity: 3, price: "5.00", is_taxable: null },
  { name: "DISH SOAP", quantity: null, price: "3.49", is_taxable: true },
];

function row(overrides: Partial<ItemRow>): ItemRow {
  return { ...emptyRow(MEMBERS), name: "ITEM", price: "1.00", ...overrides };
}

test("items read by the AI start shared by everyone", () => {
  const rows = rowsFromExtracted(EXTRACTED, MEMBERS);

  expect(rows.map((item) => item.sharedBy)).toEqual([MEMBERS, MEMBERS, MEMBERS]);
  expect(rows[1]).toMatchObject({ name: "YOGURT", price: "5.00", quantity: 3 });
});

test("only items the receipt marks as taxed start ticked as taxed", () => {
  const rows = rowsFromExtracted(EXTRACTED, MEMBERS);

  // false, "does not say" and true.
  expect(rows.map((item) => item.isTaxable)).toEqual([false, false, true]);
});

test("every row gets its own key", () => {
  const rows = rowsFromExtracted([EXTRACTED[0], EXTRACTED[0]], MEMBERS);

  expect(rows[0].key).not.toBe(rows[1].key);
});

test("a saved split comes back with the same people", () => {
  const saved = [{ name: "PIZZA", price: "24.00", is_taxable: true, shared_by: [2, 3] }];

  expect(rowsFromSaved(saved)[0]).toMatchObject({
    name: "PIZZA",
    price: "24.00",
    isTaxable: true,
    sharedBy: [2, 3],
  });
});

test("a line with a quantity splits into one row per unit that add up", () => {
  const yogurt = rowsFromExtracted(EXTRACTED, MEMBERS)[1];

  expect(canSplitRow(yogurt)).toBe(true);
  const units = splitRow(yogurt);

  expect(units.map((unit) => unit.price)).toEqual(["1.67", "1.67", "1.66"]);
  expect(units.every((unit) => unit.name === "YOGURT" && unit.quantity === null)).toBe(true);
  expect(new Set(units.map((unit) => unit.key)).size).toBe(3);
});

test("a line without a quantity, or with a bad price, cannot be split", () => {
  expect(canSplitRow(row({ quantity: null }))).toBe(false);
  expect(canSplitRow(row({ quantity: 1 }))).toBe(false);
  expect(canSplitRow(row({ quantity: 2, price: "abc" }))).toBe(false);
  const single = row({ quantity: null });
  expect(splitRow(single)).toEqual([single]);
});

test("valid rows become the items the API expects", () => {
  const rows = [
    row({ name: " MILK ", price: " 6.49 ", sharedBy: [1] }),
    row({ name: "COUPON", price: "-1.00", sharedBy: [1, 2], isTaxable: true }),
  ];

  expect(toSplitItems(rows)).toEqual({
    ok: true,
    items: [
      { name: "MILK", price: "6.49", is_taxable: false, shared_by: [1] },
      { name: "COUPON", price: "-1.00", is_taxable: true, shared_by: [1, 2] },
    ],
  });
});

test("a row with nobody ticked is refused, naming the item", () => {
  expect(toSplitItems([row({ name: "MILK", sharedBy: [] })])).toEqual({
    ok: false,
    message: 'Choose who "MILK" is for.',
  });
});

test("a missing name or a bad price is refused", () => {
  expect(toSplitItems([row({ name: "  " })])).toEqual({
    ok: false,
    message: "Item 1 needs a name.",
  });
  expect(toSplitItems([row({ name: "MILK", price: "four" })])).toMatchObject({ ok: false });
  expect(toSplitItems([row({ name: "MILK", price: "" })])).toMatchObject({ ok: false });
});

test("no rows at all is refused", () => {
  expect(toSplitItems([])).toMatchObject({ ok: false });
});
