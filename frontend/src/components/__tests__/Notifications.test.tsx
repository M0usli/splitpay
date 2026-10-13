import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

import NotificationBell, { NOTIFICATIONS_READ_EVENT } from "@/components/NotificationBell";
import Notifications from "@/components/Notifications";
import { getNotifications, markNotificationsRead, type Notification } from "@/lib/api";

// No test calls the real backend.
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getNotifications: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

const NEW: Notification = {
  id: 2,
  message: "alex@example.com sent you $20.00. For: Pizza",
  is_read: false,
  created_at: "2026-10-13T09:30:00Z",
};
const OLD: Notification = {
  id: 1,
  message: "jo@example.com declined your request for $7.00.",
  is_read: true,
  created_at: "2026-10-12T18:05:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getNotifications).mockResolvedValue({ unread_count: 1, items: [NEW, OLD] });
  vi.mocked(markNotificationsRead).mockResolvedValue(undefined);
});

// --- the page ---

test("lists the messages, newest first, and marks the new ones", async () => {
  render(<Notifications />);

  const rows = await screen.findAllByRole("listitem");
  expect(rows[0]).toHaveTextContent("New: alex@example.com sent you $20.00. For: Pizza");
  expect(rows[0]).toHaveTextContent("2026-10-13 09:30 UTC");
  expect(rows[1]).toHaveTextContent("jo@example.com declined your request for $7.00.");
  expect(rows[1]).not.toHaveTextContent("New:");
});

test("opening the page marks everything read and tells the bell", async () => {
  const heard = vi.fn();
  window.addEventListener(NOTIFICATIONS_READ_EVENT, heard);
  render(<Notifications />);

  await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledOnce());
  await waitFor(() => expect(heard).toHaveBeenCalledOnce());
  window.removeEventListener(NOTIFICATIONS_READ_EVENT, heard);
});

test("with nothing unread, nothing is marked", async () => {
  vi.mocked(getNotifications).mockResolvedValue({ unread_count: 0, items: [OLD] });
  render(<Notifications />);

  await screen.findAllByRole("listitem");
  expect(markNotificationsRead).not.toHaveBeenCalled();
});

test("says so when there are no messages", async () => {
  vi.mocked(getNotifications).mockResolvedValue({ unread_count: 0, items: [] });
  render(<Notifications />);

  expect(await screen.findByText(/Nothing yet/)).toBeInTheDocument();
});

test("says so when the page cannot be loaded", async () => {
  vi.mocked(getNotifications).mockRejectedValue(new Error("Could not reach the backend."));
  render(<Notifications />);

  expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the backend.");
});

// --- the bell in the nav bar ---

test("the bell shows how many are unread", async () => {
  vi.mocked(getNotifications).mockResolvedValue({ unread_count: 3, items: [] });
  render(<NotificationBell />);

  const bell = await screen.findByRole("link", { name: "Notifications, 3 unread" });
  expect(bell).toHaveAttribute("href", "/notifications");
  expect(bell).toHaveTextContent("3");
});

test("the bell has no number when everything is read", async () => {
  vi.mocked(getNotifications).mockResolvedValue({ unread_count: 0, items: [] });
  render(<NotificationBell />);

  await waitFor(() => expect(getNotifications).toHaveBeenCalled());
  expect(screen.getByRole("link", { name: "Notifications" })).toBeInTheDocument();
});

test("the bell drops its number when the page says everything was read", async () => {
  vi.mocked(getNotifications).mockResolvedValue({ unread_count: 3, items: [] });
  render(<NotificationBell />);
  await screen.findByRole("link", { name: "Notifications, 3 unread" });

  window.dispatchEvent(new Event(NOTIFICATIONS_READ_EVENT));

  expect(await screen.findByRole("link", { name: "Notifications" })).toBeInTheDocument();
});

test("the bell stays quiet if the count cannot be loaded", async () => {
  vi.mocked(getNotifications).mockRejectedValue(new Error("Could not reach the backend."));
  render(<NotificationBell />);

  await waitFor(() => expect(getNotifications).toHaveBeenCalled());
  expect(screen.getByRole("link", { name: "Notifications" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
