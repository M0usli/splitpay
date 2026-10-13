import { expect, test } from "vitest";

import { statementMonth } from "@/lib/statement";

test("this month and last month are written as year and month", () => {
  const today = new Date("2026-10-13T12:00:00Z");

  expect(statementMonth(today, 0)).toBe("2026-10");
  expect(statementMonth(today, 1)).toBe("2026-09");
});

test("last month before January is December of the year before", () => {
  expect(statementMonth(new Date("2026-01-05T12:00:00Z"), 1)).toBe("2025-12");
});

test("the month is counted in UTC, like the backend", () => {
  // Late on 31 October in Toronto is already 1 November in UTC.
  expect(statementMonth(new Date("2026-11-01T02:00:00Z"), 0)).toBe("2026-11");
});
