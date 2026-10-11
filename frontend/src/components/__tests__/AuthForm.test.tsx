import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import AuthForm from "@/components/AuthForm";
import { ApiError, login, register, type User } from "@/lib/api";

// The form reports a successful login through useAuth().signIn, so the tests
// swap in a fake signIn and check that it was called.
const signIn = vi.hoisted(() => vi.fn());
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => ({ signIn }) }));
// Keep the real ApiError class, replace only the functions that call the backend.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  login: vi.fn(),
  register: vi.fn(),
}));

const USER: User = { id: 1, email: "sam@example.com", created_at: "2026-10-11T09:00:00Z" };

async function fillAndSubmit(buttonName: string, password = "correct horse battery") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Email"), "sam@example.com");
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: buttonName }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

test("logging in sends the credentials and signs the user in", async () => {
  vi.mocked(login).mockResolvedValue(USER);
  render(<AuthForm mode="login" />);

  await fillAndSubmit("Log in");

  expect(login).toHaveBeenCalledWith({
    email: "sam@example.com",
    password: "correct horse battery",
  });
  expect(register).not.toHaveBeenCalled();
  expect(signIn).toHaveBeenCalledWith(USER);
});

test("a wrong password shows the backend's message and does not sign in", async () => {
  vi.mocked(login).mockRejectedValue(new ApiError("Wrong email or password", 401));
  render(<AuthForm mode="login" />);

  await fillAndSubmit("Log in");

  expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password");
  expect(signIn).not.toHaveBeenCalled();
  // The button works again, so the user can retry.
  expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
});

test("signing up creates the account and signs the user in", async () => {
  vi.mocked(register).mockResolvedValue(USER);
  render(<AuthForm mode="register" />);

  await fillAndSubmit("Create account");

  expect(register).toHaveBeenCalledOnce();
  expect(login).not.toHaveBeenCalled();
  expect(signIn).toHaveBeenCalledWith(USER);
});

test("signing up with a short password is stopped before calling the backend", async () => {
  render(<AuthForm mode="register" />);

  await fillAndSubmit("Create account", "short");

  expect(screen.getByRole("alert")).toHaveTextContent("at least 8 characters");
  expect(register).not.toHaveBeenCalled();
});

test("each form links to the other one", () => {
  const { unmount } = render(<AuthForm mode="login" />);
  expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute("href", "/register");
  unmount();

  render(<AuthForm mode="register" />);
  expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login");
});
