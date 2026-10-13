import { expect, test } from "vitest";

import { displayAmount, finishAmount, isPositiveAmount, pressKey, type PadKey } from "@/lib/amountInput";

/** Press several keys in a row, starting from an empty amount. */
function press(...keys: PadKey[]): string {
  return keys.reduce((amount, key) => pressKey(amount, key), "");
}

test("digits build the amount from left to right", () => {
  expect(press("1", "2", "5")).toBe("125");
});

test("the point starts the cents, and only two digits of cents fit", () => {
  expect(press("1", "2", ".", "5")).toBe("12.5");
  expect(press("1", "2", ".", "5", "0", "9")).toBe("12.50");
});

test("a second point is ignored", () => {
  expect(press("1", ".", ".", "5")).toBe("1.5");
});

test("a point on an empty amount starts with a zero", () => {
  expect(press(".", "5")).toBe("0.5");
});

test("there are no leading zeros", () => {
  expect(press("0", "0", "5")).toBe("5");
  expect(press("0", ".", "5")).toBe("0.5");
});

test("erase removes one character at a time, down to empty", () => {
  expect(press("1", "2", ".", "5", "back")).toBe("12.");
  expect(press("7", "back")).toBe("");
  expect(press("back")).toBe("");
});

test("the amount cannot grow past five whole digits", () => {
  expect(press("1", "2", "3", "4", "5", "6")).toBe("12345");
  // Cents can still be added.
  expect(press("1", "2", "3", "4", "5", ".", "9")).toBe("12345.9");
});

test("an empty amount is shown as 0", () => {
  expect(displayAmount("")).toBe("0");
  expect(displayAmount("12.")).toBe("12.");
});

test("only an amount above zero can be sent", () => {
  for (const good of ["5", "0.01", "12.5", "12."]) {
    expect(isPositiveAmount(good)).toBe(true);
  }
  for (const bad of ["", "0", "0.", "0.00"]) {
    expect(isPositiveAmount(bad)).toBe(false);
  }
});

test("a trailing point is dropped before sending", () => {
  expect(finishAmount("12.")).toBe("12");
  expect(finishAmount("12.5")).toBe("12.5");
});
