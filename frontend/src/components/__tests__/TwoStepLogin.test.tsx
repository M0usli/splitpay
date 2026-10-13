import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import AuthForm from "@/components/AuthForm";
import TwoStepLogin from "@/components/TwoStepLogin";
import {
  ApiError,
  disableTwoStep,
  enableTwoStep,
  getTwoStep,
  login,
  startTwoStepSetup,
  type User,
} from "@/lib/api";

const mocks = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => ({ signIn: mocks.signIn }) }));
// No test calls the real backend.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  disableTwoStep: vi.fn(),
  enableTwoStep: vi.fn(),
  getTwoStep: vi.fn(),
  login: vi.fn(),
  startTwoStepSetup: vi.fn(),
}));

const SETUP = {
  secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
  uri: "otpauth://totp/SplitPay%3Asam%40example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=SplitPay",
};
const USER: User = { id: 1, email: "sam@example.com", created_at: "2026-10-11T09:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTwoStep).mockResolvedValue({ is_enabled: false });
  vi.mocked(startTwoStepSetup).mockResolvedValue(SETUP);
  vi.mocked(enableTwoStep).mockResolvedValue({ is_enabled: true });
  vi.mocked(disableTwoStep).mockResolvedValue({ is_enabled: false });
});

const click = (name: string) => userEvent.click(screen.getByRole("button", { name }));

// --- the card on the Security page ---

test("turning it on shows a code to scan, the key, and asks for a first code", async () => {
  render(<TwoStepLogin />);

  await userEvent.click(await screen.findByRole("button", { name: "Turn on two-step login" }));

  expect(await screen.findByTitle("Code for your authenticator app")).toBeInTheDocument();
  expect(screen.getByText(SETUP.secret)).toBeInTheDocument();
  expect(screen.getByText(/no recovery codes/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Turn on" })).toBeDisabled();
  expect(enableTwoStep).not.toHaveBeenCalled();
});

test("the first code turns it on", async () => {
  render(<TwoStepLogin />);

  await userEvent.click(await screen.findByRole("button", { name: "Turn on two-step login" }));
  await userEvent.type(await screen.findByLabelText("6-digit code"), "287 082");
  await click("Turn on");

  // Only the digits are kept.
  expect(enableTwoStep).toHaveBeenCalledWith("287082");
  expect(await screen.findByRole("status")).toHaveTextContent("Two-step login is on.");
  expect(screen.getByRole("button", { name: "Turn off" })).toBeInTheDocument();
});

test("a wrong first code says so and stays on the set-up", async () => {
  vi.mocked(enableTwoStep).mockRejectedValue(
    new ApiError("That code is not right. Wait for a new one and try again.", 400),
  );
  render(<TwoStepLogin />);

  await userEvent.click(await screen.findByRole("button", { name: "Turn on two-step login" }));
  await userEvent.type(await screen.findByLabelText("6-digit code"), "000000");
  await click("Turn on");

  expect(await screen.findByRole("alert")).toHaveTextContent("That code is not right");
  expect(screen.getByLabelText("6-digit code")).toHaveValue("");
  expect(screen.getByText(SETUP.secret)).toBeInTheDocument();
});

test("turning it off needs a code", async () => {
  vi.mocked(getTwoStep).mockResolvedValue({ is_enabled: true });
  render(<TwoStepLogin />);

  await userEvent.click(await screen.findByRole("button", { name: "Turn off" }));
  await userEvent.type(screen.getByLabelText("6-digit code"), "287082");
  await click("Turn off two-step login");

  expect(disableTwoStep).toHaveBeenCalledWith("287082");
  expect(await screen.findByRole("status")).toHaveTextContent("Two-step login is off.");
});

test("Cancel leaves it as it was", async () => {
  render(<TwoStepLogin />);

  await userEvent.click(await screen.findByRole("button", { name: "Turn on two-step login" }));
  await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));

  expect(screen.getByRole("button", { name: "Turn on two-step login" })).toBeInTheDocument();
  expect(enableTwoStep).not.toHaveBeenCalled();
});

// --- logging in ---

async function fillInAndLogIn() {
  await userEvent.type(screen.getByLabelText("Email"), "sam@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "a-long-enough-password");
  await click("Log in");
}

test("an account with two-step login is asked for the code after the password", async () => {
  vi.mocked(login)
    .mockRejectedValueOnce(new ApiError("Enter the 6-digit code from your authenticator app.", 403))
    .mockResolvedValueOnce(USER);
  render(<AuthForm mode="login" />);

  await fillInAndLogIn();
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter the 6-digit code");
  await userEvent.type(screen.getByLabelText("6-digit code"), "287082");
  await click("Log in");

  expect(login).toHaveBeenLastCalledWith({
    email: "sam@example.com",
    password: "a-long-enough-password",
    code: "287082",
  });
  expect(mocks.signIn).toHaveBeenCalledWith(USER);
});

test("the code field is not shown to accounts without two-step login", async () => {
  vi.mocked(login).mockResolvedValue(USER);
  render(<AuthForm mode="login" />);

  expect(screen.queryByLabelText("6-digit code")).not.toBeInTheDocument();
  await fillInAndLogIn();

  expect(login).toHaveBeenCalledWith({ email: "sam@example.com", password: "a-long-enough-password" });
});

test("a wrong password does not ask for a code", async () => {
  vi.mocked(login).mockRejectedValue(new ApiError("Wrong email or password", 401));
  render(<AuthForm mode="login" />);

  await fillInAndLogIn();

  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password");
  expect(screen.queryByLabelText("6-digit code")).not.toBeInTheDocument();
});
