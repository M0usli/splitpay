import { expect, test } from "vitest";

import { newRequestId } from "@/lib/requestId";

test("a request id is 32 hexadecimal characters", () => {
  expect(newRequestId()).toMatch(/^[0-9a-f]{32}$/);
});

test("every request id is different", () => {
  const ids = new Set(Array.from({ length: 200 }, () => newRequestId()));

  expect(ids.size).toBe(200);
});
