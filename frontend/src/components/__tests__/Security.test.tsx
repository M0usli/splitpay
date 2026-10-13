import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import PinPrompt from "@/components/PinPrompt";
import Security from "@/components/Security";
import { getPin, setPin } from "@/lib/api";
import { enterPin } from "@/test/enterPin";

// No test calls the real backend.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getPin: vi.fn(),
  setPin: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPin).mockResolvedValue({ is_set: false, locked_minutes: 0 });
  vi.mocked(setPin).mockResolvedValue({ is_set: true, locked_minutes: 0 });
});

const click = (name: string) => userEvent.click(screen.getByRole("button", { name }));

// --- making and changing the PIN ---

test("a new PIN is entered twice and then saved", async () => {
  render(<Security />);

  await userEvent.click(await screen.findByRole("button", { name: "Create a PIN" }));
  await enterPin("4826");
  expect(screen.getByRole("heading", { name: "Enter it again" })).toBeInTheDocument();
  expect(setPin).not.toHaveBeenCalled();
  await enterPin("4826");

  expect(setPin).toHaveBeenCalledWith("4826", null);
  expect(await screen.findByRole("status")).toHaveTextContent("Your payment PIN is set.");
  expect(screen.getByRole("button", { name: "Change PIN" })).toBeInTheDocument();
});

test("two different entries are not saved", async () => {
  render(<Security />);

  await userEvent.click(await screen.findByRole("button", { name: "Create a PIN" }));
  await enterPin("4826");
  await enterPin("4827");

  expect(setPin).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("The two PINs were not the same");
  expect(screen.getByRole("heading", { name: "Choose a new PIN" })).toBeInTheDocument();
});

test("the digits are never shown", async () => {
  render(<Security />);

  await userEvent.click(await screen.findByRole("button", { name: "Create a PIN" }));
  await enterPin("48");

  expect(screen.getByText("2 of 4 digits entered")).toBeInTheDocument();
  expect(screen.queryByText("48")).not.toBeInTheDocument();
});

test("changing the PIN asks for the current one first", async () => {
  vi.mocked(getPin).mockResolvedValue({ is_set: true, locked_minutes: 0 });
  render(<Security />);

  await userEvent.click(await screen.findByRole("button", { name: "Change PIN" }));
  expect(screen.getByRole("heading", { name: "Your current PIN" })).toBeInTheDocument();
  await enterPin("4826");
  await enterPin("5937");
  await enterPin("5937");

  expect(setPin).toHaveBeenCalledWith("5937", "4826");
  expect(await screen.findByRole("status")).toHaveTextContent("Your payment PIN was changed.");
});

test("a refusal from the backend is shown and the steps start again", async () => {
  vi.mocked(getPin).mockResolvedValue({ is_set: true, locked_minutes: 0 });
  vi.mocked(setPin).mockRejectedValue(new Error("Wrong PIN. 4 tries left."));
  render(<Security />);

  await userEvent.click(await screen.findByRole("button", { name: "Change PIN" }));
  await enterPin("9990");
  await enterPin("5937");
  await enterPin("5937");

  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong PIN. 4 tries left.");
  expect(screen.getByRole("heading", { name: "Your current PIN" })).toBeInTheDocument();
});

test("Back leaves without saving", async () => {
  render(<Security />);

  await userEvent.click(await screen.findByRole("button", { name: "Create a PIN" }));
  await enterPin("48");
  await click("Back");

  expect(screen.getByRole("button", { name: "Create a PIN" })).toBeInTheDocument();
  expect(setPin).not.toHaveBeenCalled();
});

// --- the prompt shown before every payment ---

function renderPrompt(error: string | null = null) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  render(
    <PinPrompt
      what="Send $20.00 to alex@example.com"
      error={error}
      isBusy={false}
      onBack={() => {}}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

test("the prompt says what is being paid and submits after four digits", async () => {
  vi.mocked(getPin).mockResolvedValue({ is_set: true, locked_minutes: 0 });
  const onSubmit = renderPrompt();

  expect(screen.getByText("Send $20.00 to alex@example.com")).toBeInTheDocument();
  await enterPin("482");
  expect(onSubmit).not.toHaveBeenCalled();
  await enterPin("6");

  expect(onSubmit).toHaveBeenCalledWith("4826");
});

test("without a PIN the prompt sends the user to make one", async () => {
  renderPrompt();

  expect(await screen.findByRole("link", { name: "Set a payment PIN" })).toHaveAttribute(
    "href",
    "/security",
  );
  expect(screen.queryByRole("button", { name: "1" })).not.toBeInTheDocument();
});

test("a locked PIN says how long to wait", async () => {
  vi.mocked(getPin).mockResolvedValue({ is_set: true, locked_minutes: 15 });
  renderPrompt();

  expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 15 minutes");
});

test("a wrong PIN shows the backend's answer", async () => {
  vi.mocked(getPin).mockResolvedValue({ is_set: true, locked_minutes: 0 });
  renderPrompt("Wrong PIN. 3 tries left.");

  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong PIN. 3 tries left.");
});
