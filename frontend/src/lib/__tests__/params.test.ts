import { expect, test } from "vitest";

import { parseId } from "@/lib/params";

test("accepts a positive whole number", () => {
  expect(parseId("7")).toBe(7);
});

test.each(["abc", "", "0", "-2", "1.5", "7abc", " 7"])("rejects %j", (segment) => {
  expect(parseId(segment)).toBeNull();
});
