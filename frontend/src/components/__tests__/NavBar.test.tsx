import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

import type { AuthStatus } from "@/components/AuthProvider";
import NavBar from "@/components/NavBar";
import { logout } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  auth: { state: "signedOut" } as AuthStatus,
  signOut: vi.fn(),
}));
vi.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ auth: mocks.auth, signOut: mocks.signOut }),
}));
vi.mock("@/lib/api", () => ({ logout: vi.fn() }));

const SIGNED_IN: AuthStatus = {
  state: "signedIn",
  user: { id: 1, email: "sam@example.com", created_at: "2026-10-11T09:00:00Z" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth = SIGNED_IN;
});

test("a signed-out visitor sees only the app name", () => {
  mocks.auth = { state: "signedOut" };
  render(<NavBar />);

  expect(screen.getByRole("link", { name: "Receipt Tracker" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Menu" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Expenses" })).not.toBeInTheDocument();
});

test("a signed-in user gets a link to every page, and their email", () => {
  render(<NavBar />);

  for (const name of ["Upload", "Expenses", "Dashboard", "Split bill", "Recurring", "Bank", "Add expense"]) {
    expect(screen.getByRole("link", { name })).toBeInTheDocument();
  }
  expect(screen.getByText("sam@example.com")).toBeInTheDocument();
});

test("the Menu button opens and closes the links, and says which", async () => {
  render(<NavBar />);
  const menuButton = screen.getByRole("button", { name: "Menu" });
  const menu = document.getElementById("nav-menu");

  // Closed to start with. (Wide screens show the links anyway, through CSS.)
  expect(menuButton).toHaveAttribute("aria-expanded", "false");
  expect(menu).toHaveClass("hidden");

  await userEvent.click(menuButton);
  expect(menuButton).toHaveAttribute("aria-expanded", "true");
  expect(menu).not.toHaveClass("hidden");

  await userEvent.click(menuButton);
  expect(menuButton).toHaveAttribute("aria-expanded", "false");
});

test("choosing a page closes the menu", async () => {
  render(<NavBar />);
  await userEvent.click(screen.getByRole("button", { name: "Menu" }));

  await userEvent.click(screen.getByRole("link", { name: "Expenses" }));

  expect(screen.getByRole("button", { name: "Menu" })).toHaveAttribute("aria-expanded", "false");
});

test("logging out tells the backend and then the app", async () => {
  vi.mocked(logout).mockResolvedValue(undefined);
  render(<NavBar />);

  await userEvent.click(screen.getByRole("button", { name: "Log out" }));

  expect(logout).toHaveBeenCalledOnce();
  expect(mocks.signOut).toHaveBeenCalledOnce();
});

test("a failed log-out keeps the user signed in", async () => {
  vi.mocked(logout).mockRejectedValue(new Error("Could not reach the backend."));
  render(<NavBar />);

  await userEvent.click(screen.getByRole("button", { name: "Log out" }));

  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Log out" })).toBeEnabled();
});
