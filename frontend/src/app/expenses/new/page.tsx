import NewExpenseForm from "@/components/NewExpenseForm";

export default function NewExpensePage() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Add expense</h1>
      <p className="mt-1 text-sm text-zinc-600">Enter an expense by hand.</p>

      <section className="mt-6 rounded-2xl border border-zinc-200 bg-white shadow-sm p-5">
        <NewExpenseForm />
      </section>
    </main>
  );
}
