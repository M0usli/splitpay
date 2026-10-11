import { describe, expect, test } from "vitest";

import { formatMoney, formatMonth, sumAmounts } from "@/lib/format";

describe("sumAmounts", () => {
  test("adds amounts without floating-point rounding errors", () => {
    // In plain JavaScript, 0.1 + 0.2 is 0.30000000000000004.
    expect(sumAmounts(["0.10", "0.20"])).toBe("0.30");
  });

  test("returns 0.00 for an empty list", () => {
    expect(sumAmounts([])).toBe("0.00");
  });

  test("keeps two decimal places", () => {
    expect(sumAmounts(["38.47", "6.64", "7.44"])).toBe("52.55");
  });
});

describe("formatMoney", () => {
  test("formats Canadian dollars", () => {
    expect(formatMoney("1234.5", "CAD")).toBe("$1,234.50");
  });

  test("marks other currencies so they are not mistaken for CAD", () => {
    expect(formatMoney("10.00", "USD")).toBe("US$10.00");
  });
});

describe("formatMonth", () => {
  test("writes the month in words", () => {
    expect(formatMonth("2026-10")).toBe("October 2026");
  });

  test("has a short style for chart labels", () => {
    expect(formatMonth("2026-01", "short")).toBe("Jan");
  });
});
