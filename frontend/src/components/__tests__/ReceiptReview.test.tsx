import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import ReceiptReview from "@/components/ReceiptReview";
import { getReceipt, rerunExtraction, type Receipt } from "@/lib/api";

// No test calls the real backend. The image and the form have their own tests.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getReceipt: vi.fn(),
  rerunExtraction: vi.fn(),
}));
vi.mock("@/components/ReceiptImage", () => ({ default: () => null }));
vi.mock("@/components/ExpenseForm", () => ({ default: () => null }));

/** A receipt whose text was read but whose details were not: the AI can be asked again. */
const NOT_EXTRACTED: Receipt = {
  id: 7,
  status: "failed",
  raw_text: "FRESHCO TOTAL 38.47",
  extracted_fields: null,
  error_message: "Could not reach the AI service.",
  created_at: "2026-10-08T14:32:07Z",
  warnings: [],
  needs_review: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getReceipt).mockResolvedValue(NOT_EXTRACTED);
});

test("a failed read-again shows why and keeps the receipt on screen", async () => {
  vi.mocked(rerunExtraction).mockRejectedValue(new Error("Too many attempts. Try again in 5 minutes."));
  render(<ReceiptReview receiptId={7} />);

  await userEvent.click(await screen.findByRole("button", { name: "Read the details with AI" }));

  expect(await screen.findByText("Too many attempts. Try again in 5 minutes.")).toBeInTheDocument();
  // The page is still the review page, so the user can try again or type the details.
  expect(screen.getByRole("button", { name: "Read the details with AI" })).toBeEnabled();
  expect(screen.getByText("The receipt could not be read automatically.")).toBeInTheDocument();
});

test("a successful read-again clears an earlier error", async () => {
  vi.mocked(rerunExtraction)
    .mockRejectedValueOnce(new Error("Could not reach the backend."))
    .mockResolvedValueOnce({ ...NOT_EXTRACTED, status: "extracted", error_message: null });
  render(<ReceiptReview receiptId={7} />);

  await userEvent.click(await screen.findByRole("button", { name: "Read the details with AI" }));
  await screen.findByText("Could not reach the backend.");
  await userEvent.click(screen.getByRole("button", { name: "Read the details with AI" }));

  expect(screen.queryByText("Could not reach the backend.")).not.toBeInTheDocument();
});
