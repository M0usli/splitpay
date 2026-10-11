"use client";

import Link from "next/link";
import { useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { logout } from "@/lib/api";

const links = [
  { href: "/", label: "Upload" },
  { href: "/expenses", label: "Expenses" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/expenses/new", label: "Add expense" },
];

export default function NavBar() {
  const { auth, signOut } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
      // RequireLogin sees that nobody is signed in and opens the log-in page.
      signOut();
    } catch {
      // Still signed in (for example the backend is down). The button
      // becomes usable again so the user can retry.
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <header className="border-b border-zinc-200 bg-white">
      <nav className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-x-6 gap-y-1 px-6 py-3">
        <Link href="/" className="whitespace-nowrap font-semibold tracking-tight">
          Receipt Tracker
        </Link>
        {auth.state === "signedIn" && (
          <>
            <ul className="flex gap-4 whitespace-nowrap text-sm text-zinc-600">
              {links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-zinc-900">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="ml-auto flex items-center gap-3 whitespace-nowrap text-sm text-zinc-600">
              <span>{auth.user.email}</span>
              <button
                type="button"
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-50 disabled:opacity-50"
              >
                Log out
              </button>
            </div>
          </>
        )}
      </nav>
    </header>
  );
}
