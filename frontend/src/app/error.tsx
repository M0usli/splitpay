"use client"; // Error boundaries must be Client Components.

import { useEffect } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

/**
 * Shown when a page crashes while rendering. Without this file the user
 * would see a blank screen. Errors from the API are handled inside each
 * component; this is the safety net for bugs nobody expected.
 */
export default function ErrorPage({ error, retry }: ErrorPageProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="mt-2 text-zinc-600">
        This page hit an unexpected problem. Your saved expenses are not affected.
      </p>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
      >
        Try again
      </button>
    </main>
  );
}
