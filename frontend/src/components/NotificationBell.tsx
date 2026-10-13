"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { getNotifications } from "@/lib/api";

/** Sent on the window when the notifications page has marked everything read. */
export const NOTIFICATIONS_READ_EVENT = "notifications-read";

/**
 * A bell in the nav bar with the number of unread notifications.
 *
 * The number is fetched again every time the user moves to another page.
 * There is no live connection to the server, so a message that arrives
 * while a page is open shows up on the next move.
 */
export default function NotificationBell() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let isCurrent = true;
    getNotifications()
      .then((result) => {
        if (isCurrent) {
          setUnread(result.unread_count);
        }
      })
      // The bell is an extra: if it cannot be loaded, the page still works.
      .catch(() => {});
    return () => {
      isCurrent = false;
    };
  }, [pathname]);

  useEffect(() => {
    const clear = () => setUnread(0);
    window.addEventListener(NOTIFICATIONS_READ_EVENT, clear);
    return () => window.removeEventListener(NOTIFICATIONS_READ_EVENT, clear);
  }, []);

  return (
    <Link
      href="/notifications"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      className="relative ml-auto rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm hover:bg-zinc-50 lg:order-last lg:ml-0"
    >
      <span aria-hidden>🔔</span>
      {unread > 0 && (
        <span
          aria-hidden
          className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-xs font-semibold text-white"
        >
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
