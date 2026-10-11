"use client";

import { useRouter } from "next/navigation";

import ExpenseForm from "@/components/ExpenseForm";
import { createExpense, type ExpenseUpdate } from "@/lib/api";

/** The form for adding an expense by hand (no receipt). */
export default function NewExpenseForm() {
  const router = useRouter();

  async function handleSubmit(expense: ExpenseUpdate) {
    await createExpense({ ...expense, receipt_id: null });
    router.push("/expenses");
  }

  return <ExpenseForm submitLabel="Save expense" onSubmit={handleSubmit} />;
}
