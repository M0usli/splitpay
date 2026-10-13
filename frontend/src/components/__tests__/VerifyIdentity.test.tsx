import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import VerifyIdentity from "@/components/VerifyIdentity";
import { getIdentity, submitIdentity, type Identity } from "@/lib/api";
import { helpLinkFor } from "@/lib/helpLink";

// No test calls the real backend.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getIdentity: vi.fn(),
  submitIdentity: vi.fn(),
}));

const UNVERIFIED: Identity = {
  status: "unverified",
  full_name: null,
  document_type: null,
  document_last4: null,
  rejection_reason: null,
};
const VERIFIED: Identity = {
  status: "verified",
  full_name: "Noor Example",
  document_type: "passport",
  document_last4: "4567",
  rejection_reason: null,
};
const REJECTED: Identity = {
  ...VERIFIED,
  status: "rejected",
  rejection_reason: "You must be 18 or older to send money.",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getIdentity).mockResolvedValue(UNVERIFIED);
  vi.mocked(submitIdentity).mockResolvedValue(VERIFIED);
});

const click = (name: string | RegExp) => userEvent.click(screen.getByRole("button", { name }));

/** Fill in steps 1 and 2 and stop on the review step. */
async function fillInUpToReview() {
  await userEvent.type(await screen.findByLabelText("Full name"), "Noor Example");
  await userEvent.type(screen.getByLabelText("Date of birth"), "2000-05-17");
  await click("Continue");
  await click("Canada");
  await click("Passport");
  await userEvent.type(screen.getByLabelText("Document number"), "p1234567");
  await click("Review");
}

test("the details are shown back before anything is sent", async () => {
  render(<VerifyIdentity />);

  await fillInUpToReview();

  const review = within(screen.getByRole("region", { name: "Check your details" }));
  expect(review.getByText("Noor Example")).toBeInTheDocument();
  expect(review.getByText("2000-05-17")).toBeInTheDocument();
  expect(review.getByText("Canada")).toBeInTheDocument();
  expect(review.getByText("P1234567")).toBeInTheDocument();
  expect(submitIdentity).not.toHaveBeenCalled();
});

test("submitting sends the details and shows the verified screen", async () => {
  render(<VerifyIdentity />);

  await fillInUpToReview();
  await click("Submit");

  expect(submitIdentity).toHaveBeenCalledWith({
    full_name: "Noor Example",
    date_of_birth: "2000-05-17",
    country: "CA",
    document_type: "passport",
    document_number: "p1234567",
  });
  expect(await screen.findByRole("status")).toHaveTextContent("Your identity is verified");
  expect(screen.getByText("ends in 4567")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to your wallet" })).toHaveAttribute("href", "/");
});

test("Review stays off until a country and a document are chosen", async () => {
  render(<VerifyIdentity />);

  await userEvent.type(await screen.findByLabelText("Full name"), "Noor Example");
  await userEvent.type(screen.getByLabelText("Date of birth"), "2000-05-17");
  await click("Continue");

  expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
  await click("Saudi Arabia");
  expect(screen.getByRole("button", { name: "Review" })).toBeDisabled();
  await click("National ID");
  expect(screen.getByRole("button", { name: "Review" })).toBeEnabled();
});

test("the form warns not to use a real document number", async () => {
  render(<VerifyIdentity />);

  await userEvent.type(await screen.findByLabelText("Full name"), "Noor Example");
  await userEvent.type(screen.getByLabelText("Date of birth"), "2000-05-17");
  await click("Continue");

  expect(screen.getByText(/Do not type a real document number/)).toBeInTheDocument();
});

test("a rejection shows the reason and lets the user try again", async () => {
  vi.mocked(submitIdentity).mockResolvedValue(REJECTED);
  render(<VerifyIdentity />);

  await fillInUpToReview();
  await click("Submit");

  expect(await screen.findByRole("alert")).toHaveTextContent("You must be 18 or older");
  await click("Try again");
  // Back at step 1, with what was typed still there.
  expect(screen.getByLabelText("Full name")).toHaveValue("Noor Example");
});

test("a user who was rejected earlier sees the reason when the page opens", async () => {
  vi.mocked(getIdentity).mockResolvedValue(REJECTED);
  render(<VerifyIdentity />);

  expect(await screen.findByText("We could not verify you")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("a verified user sees their result, not the form", async () => {
  vi.mocked(getIdentity).mockResolvedValue(VERIFIED);
  render(<VerifyIdentity />);

  expect(await screen.findByRole("status")).toHaveTextContent("Your identity is verified");
  expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
});

test("an error from the backend is shown on the review step", async () => {
  vi.mocked(submitIdentity).mockRejectedValue(new Error("Could not reach the backend."));
  render(<VerifyIdentity />);

  await fillInUpToReview();
  await click("Submit");

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the backend.");
  expect(screen.getByRole("button", { name: "Submit" })).toBeEnabled();
});

// --- the link that goes with a refusal ---

test("a refusal with an obvious next step gets a link to it", () => {
  expect(helpLinkFor("Verify your identity before sending money.")).toEqual({
    href: "/verify",
    label: "Verify your identity",
  });
  expect(helpLinkFor("You do not have enough money in your wallet.")).toEqual({
    href: "/",
    label: "Add money to your wallet",
  });
  expect(helpLinkFor("No account has this email")).toBeNull();
  expect(helpLinkFor(null)).toBeNull();
});
