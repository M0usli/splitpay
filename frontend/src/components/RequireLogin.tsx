"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuth } from "@/components/AuthProvider";

// Pages a signed-out visitor may see.
const PUBLIC_PATHS = ["/login", "/register"];

/**
 * Shows the page only to the right audience: signed-out visitors are sent to
 * the log-in page, and signed-in users are sent away from it.
 *
 * This is for a smooth experience, not for security. Anyone can change code
 * that runs in their own browser, so the real protection must be on the
 * backend (Phase 3).
 */
export default function RequireLogin({ children }: { children: ReactNode }) {
  const { auth } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const isPublicPage = PUBLIC_PATHS.includes(pathname);
  const mustLogIn = auth.state === "signedOut" && !isPublicPage;
  const alreadyLoggedIn = auth.state === "signedIn" && isPublicPage;

  useEffect(() => {
    // replace, not push: the Back button should not return to a page the
    // visitor was just sent away from.
    if (mustLogIn) {
      router.replace("/login");
    } else if (alreadyLoggedIn) {
      router.replace("/");
    }
  }, [mustLogIn, alreadyLoggedIn, router]);

  if (auth.state === "error") {
    return (
      <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {auth.message}
        </p>
      </main>
    );
  }

  const showPage = auth.state !== "loading" && !mustLogIn && !alreadyLoggedIn;

  return (
    <>
      {!showPage && (
        <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
          <p className="text-sm text-zinc-500">Loading…</p>
        </main>
      )}
      {/* The page is hidden, not removed: Next.js prepares each page's HTML on
          the server, before anyone's login is known, and warns if the page is
          missing from it. "contents" makes this div invisible to the layout. */}
      <div hidden={!showPage} className="contents">
        {children}
      </div>
    </>
  );
}
