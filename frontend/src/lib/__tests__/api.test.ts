import { afterEach, expect, test, vi } from "vitest";

import { ApiError, deleteExpense, getExpense, listExpenses } from "@/lib/api";

/** Replace the browser's fetch with a fake that answers with the given response. */
function mockFetch(response: Response) {
  const fetchMock = vi.fn(() => Promise.resolve(response));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

test("listExpenses only sends the filters that are set", async () => {
  const fetchMock = mockFetch(Response.json([]));

  await listExpenses({ month: "2026-10", category: "" });

  expect(fetchMock).toHaveBeenCalledWith("http://localhost:8000/expenses?month=2026-10", undefined);
});

test("an error message from the API is passed on", async () => {
  mockFetch(Response.json({ detail: "Expense not found" }, { status: 404 }));

  const error = await getExpense(99).catch((caught: unknown) => caught);

  expect(error).toBeInstanceOf(ApiError);
  expect(error).toMatchObject({ message: "Expense not found", status: 404 });
});

test("validation problems are joined into one readable message", async () => {
  const detail = [
    { loc: ["body", "total"], msg: "Input should be greater than or equal to 0", type: "x" },
    { loc: ["body", "date"], msg: "Field required", type: "x" },
  ];
  mockFetch(Response.json({ detail }, { status: 422 }));

  await expect(getExpense(1)).rejects.toThrow(
    "total: Input should be greater than or equal to 0; date: Field required",
  );
});

test("a network failure gets a friendly message", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));

  await expect(getExpense(1)).rejects.toThrow("Could not reach the backend. Is it running?");
});

test("a 204 response has no body to read", async () => {
  mockFetch(new Response(null, { status: 204 }));

  await expect(deleteExpense(1)).resolves.toBeUndefined();
});
