"use client";

import { useEffect, useState } from "react";

import { NOTIFICATIONS_READ_EVENT } from "@/components/NotificationBell";
import {
  errorMessage,
  getNotifications,
  markNotificationsRead,
  type Notification,
} from "@/lib/api";

type Status =
  | { state: "loading" }
  | { state: "loaded"; items: Notification[] }
  | { state: "error"; message: string };

/** The notifications page: what happened to your money, newest first. */
export default function Notifications() {
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    let isCurrent = true;
    getNotifications()
      .then((result) => {
        if (!isCurrent) {
          return;
        }
        // Shown as they were when the page opened, so the new ones stand out.
        setStatus({ state: "loaded", items: result.items });
        if (result.unread_count > 0) {
          // Opening the page counts as reading them. The bell is told to drop its number.
          void markNotificationsRead()
            .then(() => window.dispatchEvent(new Event(NOTIFICATIONS_READ_EVENT)))
            .catch(() => {});
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          const message = errorMessage(error);
          setStatus({ state: "error", message });
        }
      });
    return () => {
      isCurrent = false;
    };
  }, []);

  if (status.state === "loading") {
    return <p className="text-zinc-500">Loading…</p>;
  }
  if (status.state === "error") {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {status.message}
      </p>
    );
  }
  if (status.items.length === 0) {
    return (
      <p className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500 shadow-sm">
        Nothing yet. You will see a message here when someone sends you money, asks you for
        money, or answers a request of yours.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white px-5 shadow-sm">
      {status.items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 py-3">
          <span
            aria-hidden
            className={
              "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full " +
              (item.is_read ? "bg-transparent" : "bg-emerald-600")
            }
          />
          <div className="min-w-0 flex-1">
            <p className={"break-words text-sm " + (item.is_read ? "text-zinc-700" : "font-semibold")}>
              {!item.is_read && <span className="sr-only">New: </span>}
              {item.message}
            </p>
            <p className="text-xs text-zinc-500">
              {item.created_at.slice(0, 10)} {item.created_at.slice(11, 16)} UTC
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
