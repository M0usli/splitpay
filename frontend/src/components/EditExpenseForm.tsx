"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import ExpenseForm from "@/components/ExpenseForm";
import { getExpense, updateExpense, type Expense, type ExpenseUpdate } from "@/lib/api";

type Status =
  | { state: "loading" }
  | { state: "loaded"; expense: Expense }
  | { state: "error"; message: string };

type EditExpenseFormProps = {
  expenseId: number;
};

/** Loads one expense and shows it in the form so it can be changed. */
export default function EditExpenseForm({ expenseId }: EditExpenseFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ state: "loading" });

  useEffect(() => {
    getExpense(expenseId)
      .then((expense) => setStatus({ state: "loaded", expense }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "Something went wrong";
        setStatus({ state: "error", message });
      });
  }, [expenseId]);

  if (status.state === "loading") {
    return <p className="text-zinc-500">Loading expense…</p>;
  }

  if (status.state === "error") {
    return (
      <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
        {status.message}
      </p>
    );
  }

  const { expense } = status;

  async function handleSubmit(changes: ExpenseUpdate) {
    await updateExpense(expense.id, changes);
    router.push("/expenses");
  }

  return (
    <ExpenseForm
      submitLabel="Save changes"
      initialValues={{
        merchant: expense.merchant,
        date: expense.date,
        subtotal: expense.subtotal ?? "",
        tax: expense.tax ?? "",
        total: expense.total,
        currency: expense.currency,
        category: expense.category,
        notes: expense.notes ?? "",
      }}
      onSubmit={handleSubmit}
    />
  );
}
