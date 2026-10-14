import Link from "next/link";

import ExpenseList from "@/components/ExpenseList";

export default function ExpensesPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
        <Link
          href="/expenses/new"
          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
        >
          + Add expense
        </Link>
      </div>

      <div className="mt-6">
        <ExpenseList />
      </div>
    </main>
  );
}
