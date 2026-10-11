import Link from "next/link";

// Shown for any address that matches no page, and when a page calls notFound().
export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-zinc-600">
        There is nothing at this address. The link may be wrong, or the item may have been deleted.
      </p>
      <Link
        href="/expenses"
        className="mt-6 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
      >
        Go to your expenses
      </Link>
    </main>
  );
}
