import Wallet from "@/components/Wallet";

export default function WalletPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Wallet</h1>
      <p className="mt-1 text-sm text-zinc-600">Your balance, and money you send and receive.</p>

      <div className="mt-6">
        <Wallet />
      </div>
    </main>
  );
}
