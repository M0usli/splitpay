import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import ReceiptUpload from "@/components/ReceiptUpload";
import { uploadReceipt, type Receipt } from "@/lib/api";

// vi.mock swaps a whole module for a fake one. These tests never call the
// real backend, and never navigate for real. (vi.hoisted creates the fake
// "push" early enough for the mock below to use it.)
const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/lib/api", () => ({ uploadReceipt: vi.fn() }));

const RECEIPT: Receipt = {
  id: 7,
  raw_text: "FRESHCO\nTOTAL 38.47",
  status: "extracted",
  error_message: null,
  extracted_fields: null,
  created_at: "2026-10-08T14:32:07Z",
  warnings: [],
  needs_review: false,
};

function chooseFile(name: string, type: string) {
  // applyAccept: false lets the test pick a file that the "accept" list of
  // the input would hide. A user can still do that by dragging the file in.
  const user = userEvent.setup({ applyAccept: false });
  const input = screen.getByLabelText(/drag a receipt here/i);
  return user.upload(input, new File(["file contents"], name, { type }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("opens the review page after a successful upload", async () => {
  vi.mocked(uploadReceipt).mockResolvedValue(RECEIPT);
  render(<ReceiptUpload />);

  await chooseFile("receipt.png", "image/png");

  expect(uploadReceipt).toHaveBeenCalledOnce();
  expect(push).toHaveBeenCalledWith("/receipts/7");
});

test("rejects an unsupported file type without calling the backend", async () => {
  render(<ReceiptUpload />);

  await chooseFile("notes.txt", "text/plain");

  expect(screen.getByRole("alert")).toHaveTextContent("That file type is not supported");
  expect(uploadReceipt).not.toHaveBeenCalled();
});

test("offers manual entry when the receipt was saved but could not be read", async () => {
  vi.mocked(uploadReceipt).mockResolvedValue({
    ...RECEIPT,
    status: "failed",
    error_message: "No text could be found in this file.",
  });
  render(<ReceiptUpload />);

  await chooseFile("blank.png", "image/png");

  expect(screen.getByRole("alert")).toHaveTextContent("No text could be found in this file.");
  expect(screen.getByRole("link", { name: "Enter the details by hand" })).toHaveAttribute(
    "href",
    "/receipts/7",
  );
  expect(push).not.toHaveBeenCalled();
});

test("shows the error when the upload itself fails", async () => {
  vi.mocked(uploadReceipt).mockRejectedValue(
    new Error("Could not reach the backend. Is it running?"),
  );
  render(<ReceiptUpload />);

  await chooseFile("receipt.png", "image/png");

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the backend.");
});
