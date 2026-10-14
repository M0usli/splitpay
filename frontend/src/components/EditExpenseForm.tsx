"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import ExpenseForm from "@/components/ExpenseForm";
import {
  getExpense,
  getReceipt,
  rerunExtraction,
  updateExpense,
  type Expense,
  type ExpenseUpdate,
  type Receipt,
} from "@/lib/api";

type Status =
  | { state: "loading" }
  // `receipt` is the receipt the expense was made from, when there is one.
  | { state: "loaded"; expense: Expense; receipt: Receipt | null }
  | { state: "error"; message: string };

type EditExpenseFormProps = {
  expenseId: number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong";
}

/** The expense, and its receipt if it has one, so its items can be offered for splitting. */
async function loadExpense(expenseId: number): Promise<{ expense: Expense; receipt: Receipt | null }> {
  const expense = await getExpense(expenseId);
  if (expense.receipt_id === null) {
    return { expense, receipt: null };
  }
  // The receipt is a bonus here. If it cannot be loaded, the expense can
  // still be edited, just without the receipt's items.
  const receipt = await getReceipt(expense.receipt_id).catch(() => null);
  return { expense, receipt };
}

/** Loads one expense and shows it in the form so it can be changed. */
export default function EditExpenseForm({ expenseId }: EditExpenseFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ state: "loading" });
  const [isReadingItems, setIsReadingItems] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);

  useEffect(() => {
    loadExpense(expenseId)
      .then((loaded) => setStatus({ state: "loaded", ...loaded }))
      .catch((error: unknown) => setStatus({ state: "error", message: errorMessage(error) }));
  }, [expenseId]);

  if (status.state === "loading") {
    return <p className="text-zinc-500">Loading expense…</p>;
  }

  if (status.state === "error") {
    return (
      <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
        {status.message}
      </p>
    );
  }

  const { expense, receipt } = status;
  const items = receipt?.extracted_fields?.items ?? [];
  // Receipts scanned before the app read items have none. Reading the
  // receipt again fills them in, so the expense can be split item by item.
  const canReadItems = receipt !== null && items.length === 0 && receipt.raw_text !== null;

  async function handleSubmit(changes: ExpenseUpdate) {
    await updateExpense(expense.id, changes);
    router.push("/expenses");
  }

  async function handleReadItems() {
    if (receipt === null) {
      return;
    }
    setIsReadingItems(true);
    setReadError(null);
    try {
      const updated = await rerunExtraction(receipt.id);
      setStatus({ state: "loaded", expense, receipt: updated });
    } catch (error) {
      setReadError(errorMessage(error));
    } finally {
      setIsReadingItems(false);
    }
  }

  return (
    <>
      {canReadItems && (
        <div className="mb-4 rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-sm">
          <p>
            This expense came from a receipt, but its items have not been read yet. Read them to
            split the receipt item by item.
          </p>
          <button
            type="button"
            onClick={handleReadItems}
            disabled={isReadingItems}
            className="mt-2 rounded-xl border border-zinc-300 bg-white px-3 py-1.5 font-medium hover:bg-zinc-50 disabled:opacity-50"
          >
            {isReadingItems ? "Reading with AI…" : "Read the items with AI"}
          </button>
          {readError !== null && (
            <p role="alert" className="mt-2 text-red-700">
              {readError}
            </p>
          )}
        </div>
      )}

      {/* A changed key makes React build a new form, so items that were just
          read are offered in it. */}
      <ExpenseForm
        key={items.length}
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
          is_shared: expense.is_shared,
          shares: expense.is_shared ? expense.shares : null,
          split_items: expense.split_items ?? null,
        }}
        initialItems={items}
        onSubmit={handleSubmit}
      />
    </>
  );
}
