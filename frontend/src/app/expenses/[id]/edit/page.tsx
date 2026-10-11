import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import EditExpenseForm from "@/components/EditExpenseForm";
import { parseId } from "@/lib/params";

export default function EditExpensePage({ params }: PageProps<"/expenses/[id]/edit">) {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
      <Link href="/expenses" className="text-sm text-zinc-600 hover:text-zinc-900">
        ← Back to expenses
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Edit expense</h1>

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5">
        <Suspense fallback={<p className="text-zinc-500">Loading expense…</p>}>
          <ExpenseFromParams params={params} />
        </Suspense>
      </section>
    </main>
  );
}

async function ExpenseFromParams({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const expenseId = parseId(id);
  if (expenseId === null) {
    // An address like /expenses/abc/edit can never match anything: show the 404 page.
    notFound();
  }
  return <EditExpenseForm expenseId={expenseId} />;
}
