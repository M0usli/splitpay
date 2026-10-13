import { Suspense } from "react";

import WalletHome from "@/components/WalletHome";

// The home page: the wallet is the first thing a signed-in user sees.
export default function HomePage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Wallet</h1>
      <p className="mt-1 text-sm text-zinc-600">Your balance, and money you send and receive.</p>

      <div className="mt-6">
        {/* WalletHome reads the address (a scanned code puts a pay link in it),
            which is only known in the browser. */}
        <Suspense fallback={<p className="text-zinc-500">Loading…</p>}>
          <WalletHome />
        </Suspense>
      </div>
    </main>
  );
}
