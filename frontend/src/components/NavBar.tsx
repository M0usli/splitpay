"use client";

import Link from "next/link";
import { useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { logout } from "@/lib/api";

const links = [
  { href: "/", label: "Wallet" },
  { href: "/bills", label: "Bills" },
  { href: "/upload", label: "Upload" },
  { href: "/expenses", label: "Expenses" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/household", label: "Split bill" },
  { href: "/recurring", label: "Recurring" },
  { href: "/bank", label: "Bank" },
];

export default function NavBar() {
  const { auth, signOut } = useAuth();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // On a phone the links are folded away behind a Menu button.
  const [isMenuOpen, setIsMenuOpen] = useState(false);

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
      setIsMenuOpen(false);
    }
  }

  return (
    <header className="border-b border-zinc-200 bg-white">
      {/* Classes starting with "lg:" apply from laptop width up. A class
          without a prefix applies everywhere, so the plain classes describe
          the phone layout and the lg: ones change it for wide screens. */}
      <nav className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-1 px-6 py-3 lg:flex-nowrap">
        <Link href="/" className="whitespace-nowrap font-semibold tracking-tight">
          SplitPay
        </Link>
        {auth.state === "signedIn" && (
          <>
            <button
              type="button"
              aria-label="Menu"
              aria-expanded={isMenuOpen}
              aria-controls="nav-menu"
              onClick={() => setIsMenuOpen((open) => !open)}
              className="ml-auto rounded-md border border-zinc-300 px-3 py-1.5 text-sm lg:hidden"
            >
              {isMenuOpen ? "Close" : "Menu"}
            </button>

            <div
              id="nav-menu"
              className={
                (isMenuOpen ? "flex" : "hidden") +
                " w-full flex-col gap-3 pb-2 pt-3 lg:flex lg:w-auto lg:min-w-0 lg:flex-1 lg:flex-row lg:items-center lg:gap-6 lg:p-0"
              }
            >
              <ul className="flex flex-col gap-1 text-sm text-zinc-600 lg:flex-row lg:gap-4 lg:whitespace-nowrap">
                {links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      onClick={() => setIsMenuOpen(false)}
                      className="block py-2 hover:text-zinc-900 lg:py-0"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="flex min-w-0 items-center justify-between gap-3 border-t border-zinc-200 pt-3 text-sm text-zinc-600 lg:ml-auto lg:border-0 lg:pt-0">
                <span className="min-w-0 truncate">{auth.user.email}</span>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className="whitespace-nowrap rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-50 disabled:opacity-50"
                >
                  Log out
                </button>
              </div>
            </div>
          </>
        )}
      </nav>
    </header>
  );
}
