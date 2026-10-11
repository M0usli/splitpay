import RecurringCosts from "@/components/RecurringCosts";

export default function RecurringPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Recurring costs</h1>
      <p className="mt-1 text-sm text-zinc-600">
        Costs that come back every month, like rent or internet. The app adds each one to your
        expenses when its day arrives.
      </p>

      <div className="mt-6">
        <RecurringCosts />
      </div>
    </main>
  );
}
