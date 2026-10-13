import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import type { AuthStatus } from "@/components/AuthProvider";
import RequireLogin from "@/components/RequireLogin";

// Each test sets who is logged in and which page is open.
const mocks = vi.hoisted(() => ({
  auth: { state: "loading" } as AuthStatus,
  pathname: "/",
  replace: vi.fn(),
}));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => ({ auth: mocks.auth }) }));
vi.mock("next/navigation", () => {
  const router = { replace: mocks.replace };
  return { usePathname: () => mocks.pathname, useRouter: () => router };
});

const SIGNED_IN: AuthStatus = {
  state: "signedIn",
  user: { id: 1, email: "sam@example.com", created_at: "2026-10-11T09:00:00Z" },
};

function renderPage() {
  render(
    <RequireLogin>
      <p>Secret page</p>
    </RequireLogin>,
  );
}

/** Put an address in the test browser's address bar. */
function openAddress(path: string) {
  window.history.replaceState(null, "", path);
  mocks.pathname = path.split("?")[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

test("shows nothing private while still asking who is logged in", () => {
  mocks.auth = { state: "loading" };
  mocks.pathname = "/expenses";

  renderPage();

  expect(screen.getByText("Secret page")).not.toBeVisible();
  expect(mocks.replace).not.toHaveBeenCalled();
});

test("sends a signed-out visitor to the log-in page", () => {
  mocks.auth = { state: "signedOut" };
  mocks.pathname = "/expenses";

  renderPage();

  expect(screen.getByText("Secret page")).not.toBeVisible();
  expect(mocks.replace).toHaveBeenCalledWith("/login");
});

test("remembers the page a signed-out visitor wanted", () => {
  mocks.auth = { state: "signedOut" };
  openAddress("/?pay=sam%40example.com&amount=5");

  renderPage();

  expect(mocks.replace).toHaveBeenCalledWith(
    "/login?next=%2F%3Fpay%3Dsam%2540example.com%26amount%3D5",
  );
});

test("after logging in, goes back to the remembered page", () => {
  mocks.auth = SIGNED_IN;
  openAddress("/login?next=%2F%3Fpay%3Dsam%2540example.com%26amount%3D5");

  renderPage();

  expect(mocks.replace).toHaveBeenCalledWith("/?pay=sam%40example.com&amount=5");
});

test("does not follow a remembered address that leaves the app", () => {
  mocks.auth = SIGNED_IN;
  openAddress("/login?next=%2F%2Fevil.example");

  renderPage();

  expect(mocks.replace).toHaveBeenCalledWith("/");
});

test("lets a signed-out visitor see the log-in page", () => {
  mocks.auth = { state: "signedOut" };
  mocks.pathname = "/login";

  renderPage();

  expect(screen.getByText("Secret page")).toBeVisible();
  expect(mocks.replace).not.toHaveBeenCalled();
});

test("shows the page to a signed-in user", () => {
  mocks.auth = SIGNED_IN;
  mocks.pathname = "/expenses";

  renderPage();

  expect(screen.getByText("Secret page")).toBeVisible();
  expect(mocks.replace).not.toHaveBeenCalled();
});

test("sends a signed-in user away from the log-in page", () => {
  mocks.auth = SIGNED_IN;
  mocks.pathname = "/login";

  renderPage();

  expect(mocks.replace).toHaveBeenCalledWith("/");
});

test("says so when the backend cannot be reached", () => {
  mocks.auth = { state: "error", message: "Could not reach the backend. Is it running?" };
  mocks.pathname = "/expenses";

  renderPage();

  expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the backend.");
});
