import { expect, test } from "vitest";

import {
  buildShares,
  fromCents,
  sharingFromExpense,
  splitByPercent,
  splitEqually,
  toCents,
  type SharingValues,
} from "@/lib/split";

// A household of four: the logged-in user is 1.
const MEMBERS = [1, 2, 3, 4];
const ME = 1;

function sharing(overrides: Partial<SharingValues>): SharingValues {
  return { isShared: true, mode: "equal", included: MEMBERS, inputs: {}, ...overrides };
}

test("toCents reads amounts without going through a decimal number", () => {
  expect(toCents("12.50")).toBe(1250);
  expect(toCents("12.5")).toBe(1250);
  expect(toCents("12")).toBe(1200);
  expect(toCents("0.07")).toBe(7);
  // 19.99 * 100 is 1998.9999999999998 in JavaScript; this must still be 1999.
  expect(toCents("19.99")).toBe(1999);
});

test("toCents rejects anything that is not a plain amount", () => {
  for (const bad of ["", "abc", "-5", "1.234", "1,50", "."]) {
    expect(toCents(bad)).toBeNull();
  }
});

test("fromCents always shows two decimals", () => {
  expect(fromCents(1250)).toBe("12.50");
  expect(fromCents(7)).toBe("0.07");
  expect(fromCents(0)).toBe("0.00");
});

test("splitEqually gives the leftover cents to the first people", () => {
  expect(splitEqually(1000, 3)).toEqual([334, 333, 333]);
  expect(splitEqually(1000, 6)).toEqual([167, 167, 167, 167, 166, 166]);
  expect(splitEqually(1, 4)).toEqual([1, 0, 0, 0]);
});

test("splitByPercent adds up to the total", () => {
  expect(splitByPercent(10000, [6000, 4000])).toEqual([6000, 4000]);
  // A third each of 100.00: the missing cent goes to the first person.
  expect(splitByPercent(10000, [3334, 3333, 3333])).toEqual([3334, 3333, 3333]);
  // 10.01 at 50/50: one person must take the odd cent.
  expect(splitByPercent(1001, [5000, 5000])).toEqual([501, 500]);
  // 0.10 at 33.33 / 33.33 / 33.34: everyone rounds down to 3 cents, and the
  // missing cent goes to the person who lost the most to rounding (the last).
  expect(splitByPercent(10, [3333, 3333, 3334])).toEqual([3, 3, 4]);
});

test("an unshared expense sends no shares", () => {
  const result = buildShares(sharing({ isShared: false }), "40.00", MEMBERS, ME);

  expect(result).toEqual({ ok: true, isShared: false, shares: null });
});

test("an equal split among everyone is left to the backend", () => {
  const result = buildShares(sharing({}), "40.00", MEMBERS, ME);

  expect(result).toEqual({ ok: true, isShared: true, shares: null });
});

test("an equal split among some people puts the odd cent on the payer", () => {
  // 3 and 1 share 10.01; the payer (1) is listed second but takes the extra cent.
  const result = buildShares(sharing({ included: [3, 1] }), "10.01", MEMBERS, ME);

  expect(result).toEqual({
    ok: true,
    isShared: true,
    shares: [
      { user_id: 1, amount: "5.01" },
      { user_id: 3, amount: "5.00" },
    ],
  });
});

test("the payer does not have to be one of the people sharing", () => {
  const result = buildShares(sharing({ included: [2, 4] }), "24.00", MEMBERS, ME);

  expect(result).toMatchObject({
    shares: [
      { user_id: 2, amount: "12.00" },
      { user_id: 4, amount: "12.00" },
    ],
  });
});

test("a percent split becomes exact amounts", () => {
  const values = sharing({ mode: "percent", included: [1, 2], inputs: { 1: "60", 2: "40" } });

  expect(buildShares(values, "1500.00", MEMBERS, ME)).toMatchObject({
    shares: [
      { user_id: 1, amount: "900.00" },
      { user_id: 2, amount: "600.00" },
    ],
  });
});

test("percents that do not add up to 100 are refused", () => {
  const values = sharing({ mode: "percent", included: [1, 2], inputs: { 1: "60", 2: "30" } });

  expect(buildShares(values, "100.00", MEMBERS, ME)).toEqual({
    ok: false,
    message: "The percents add up to 90.00%, not 100%.",
  });
});

test("an amount split is used as typed", () => {
  const values = sharing({ mode: "amount", included: [1, 2], inputs: { 1: "56.25", 2: "31.15" } });

  expect(buildShares(values, "87.40", MEMBERS, ME)).toMatchObject({
    shares: [
      { user_id: 1, amount: "56.25" },
      { user_id: 2, amount: "31.15" },
    ],
  });
});

test("amounts that do not add up to the total are refused", () => {
  const values = sharing({ mode: "amount", included: [1, 2], inputs: { 1: "50", 2: "30" } });

  expect(buildShares(values, "87.40", MEMBERS, ME)).toEqual({
    ok: false,
    message: "The amounts add up to 80.00, but the total is 87.40.",
  });
});

test("missing inputs, nobody chosen and no total are refused", () => {
  const missing = sharing({ mode: "amount", included: [1, 2], inputs: { 1: "50" } });
  expect(buildShares(missing, "87.40", MEMBERS, ME)).toMatchObject({ ok: false });
  expect(buildShares(sharing({ included: [] }), "87.40", MEMBERS, ME)).toMatchObject({ ok: false });
  expect(buildShares(sharing({}), "", MEMBERS, ME)).toMatchObject({ ok: false });
});

test("a saved shared expense opens as exact amounts", () => {
  const saved = [
    { user_id: 1, amount: "70.00" },
    { user_id: 2, amount: "30.00" },
  ];

  const values = sharingFromExpense(true, saved);

  expect(values).toEqual({
    isShared: true,
    mode: "amount",
    included: [1, 2],
    inputs: { 1: "70.00", 2: "30.00" },
  });
  // Saving it again without touching anything sends the same shares back.
  expect(buildShares(values, "100.00", MEMBERS, ME)).toMatchObject({ shares: saved });
});
