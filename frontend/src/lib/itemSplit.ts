// The rows of the item-by-item split editor, and turning them into what the
// API expects. Working out who pays what is done by the backend
// (POST /household/split-preview), so that arithmetic exists in one place.

import type { ExtractedItem, SplitItem } from "./api";
import { fromCents, splitEqually, toCents } from "./split";

/** One line in the editor. Inputs hold text, so the price is a string here. */
export type ItemRow = {
  /** A number that stays with the row, so React can tell rows apart. */
  key: number;
  name: string;
  price: string;
  isTaxable: boolean;
  /** The ids of the members this item is for. */
  sharedBy: number[];
  /** How many units the receipt says the line covers, if it says. */
  quantity: number | null;
};

let nextKey = 1;

function newRow(row: Omit<ItemRow, "key">): ItemRow {
  return { ...row, key: nextKey++ };
}

/** A blank row, for an item the AI missed. It starts shared by everyone. */
export function emptyRow(memberIds: number[]): ItemRow {
  return newRow({ name: "", price: "", isTaxable: false, sharedBy: memberIds, quantity: null });
}

/** Rows for the items the AI read. Each starts shared by everyone. */
export function rowsFromExtracted(items: ExtractedItem[], memberIds: number[]): ItemRow[] {
  return items.map((item) =>
    newRow({
      name: item.name,
      price: item.price,
      // "The receipt does not say" starts as not taxed; the user can tick it.
      isTaxable: item.is_taxable === true,
      sharedBy: memberIds,
      quantity: item.quantity ?? null,
    }),
  );
}

/** Rows for a split that was saved earlier. */
export function rowsFromSaved(items: SplitItem[]): ItemRow[] {
  return items.map((item) =>
    newRow({
      name: item.name,
      price: item.price,
      isTaxable: item.is_taxable,
      sharedBy: item.shared_by,
      quantity: null,
    }),
  );
}

/** Can this row be split into one row per unit? */
export function canSplitRow(row: ItemRow): boolean {
  return row.quantity !== null && row.quantity > 1 && toCents(row.price) !== null;
}

/**
 * Turn "3 x YOGURT 5.00" into three rows, so each one can go to a different
 * person. The prices add up to the original: 1.67, 1.67 and 1.66.
 */
export function splitRow(row: ItemRow): ItemRow[] {
  const cents = toCents(row.price);
  if (row.quantity === null || row.quantity < 2 || cents === null) {
    return [row];
  }
  return splitEqually(cents, row.quantity).map((part) =>
    newRow({ ...row, price: fromCents(part), quantity: null }),
  );
}

/** A price that may be negative (a discount): "-1.00" is fine, "abc" is not. */
function isValidPrice(text: string): boolean {
  const trimmed = text.trim();
  return toCents(trimmed.startsWith("-") ? trimmed.slice(1) : trimmed) !== null;
}

export type SplitItemsResult =
  | { ok: true; items: SplitItem[] }
  | { ok: false; message: string };

/** Check the rows and turn them into the items the API expects. */
export function toSplitItems(rows: ItemRow[]): SplitItemsResult {
  if (rows.length === 0) {
    return { ok: false, message: "Add at least one item to split the receipt by item." };
  }
  for (const [position, row] of rows.entries()) {
    const label = row.name.trim() === "" ? `Item ${position + 1}` : `"${row.name.trim()}"`;
    if (row.name.trim() === "") {
      return { ok: false, message: `${label} needs a name.` };
    }
    if (!isValidPrice(row.price)) {
      return { ok: false, message: `${label} needs a price, like 4.99.` };
    }
    if (row.sharedBy.length === 0) {
      return { ok: false, message: `Choose who ${label} is for.` };
    }
  }
  return {
    ok: true,
    items: rows.map((row) => ({
      name: row.name.trim(),
      price: row.price.trim(),
      is_taxable: row.isTaxable,
      shared_by: row.sharedBy,
    })),
  };
}
