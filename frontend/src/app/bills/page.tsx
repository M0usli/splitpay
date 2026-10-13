import Bills from "@/components/Bills";

export default function BillsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Pay your bills from the wallet and keep a receipt for each one.
      </p>

      <div className="mt-6">
        <Bills />
      </div>
    </main>
  );
}
