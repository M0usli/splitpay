import SplitBill from "@/components/SplitBill";

export default function HouseholdPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Split bill</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Share expenses with the people you live with and see who owes whom.
      </p>

      <div className="mt-6">
        <SplitBill />
      </div>
    </main>
  );
}
